'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { buildResultSummary } = require('../lib/findings-collector');
const { withTenantTransaction } = require('../lib/db-context');
const { sanitizeCustomerResult } = require('../lib/result-sanitizer');

function stringifyResult(result) { return JSON.stringify(result); }
function sha256Hex(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function money(value) { return Number(Number(value || 0).toFixed(2)); }
function boundedText(value, max = 4000) { return String(value || '').slice(0, max); }

async function beginAttempt(pool, { scanId, tenantId, attemptId, workerName, messageId, deliveryCount }) {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const existing = await client.query(
      `SELECT s.status,
              s.processing_attempt_id,
              a.servicebus_message_id AS current_message_id,
              a.servicebus_delivery_count AS current_delivery_count,
              a.status AS current_attempt_status
         FROM scans s
         LEFT JOIN scan_attempts a
           ON a.attempt_id = s.processing_attempt_id
          AND a.scan_id = s.id
          AND a.tenant_id = s.tenant_id
        WHERE s.id = $1 AND s.tenant_id = $2
        FOR UPDATE OF s`,
      [scanId, tenantId]
    );

    if (existing.rowCount !== 1) {
      return { acquired: false, current: null, reason: 'SCAN_NOT_FOUND' };
    }

    const current = existing.rows[0];
    const incomingDeliveryCount = Number.isInteger(Number(deliveryCount))
      ? Number(deliveryCount)
      : null;
    const previousDeliveryCount = Number.isInteger(Number(current.current_delivery_count))
      ? Number(current.current_delivery_count)
      : null;
    const sameMessageRedelivery = Boolean(
      current.status === 'IN_PROGRESS' &&
      current.processing_attempt_id &&
      messageId &&
      current.current_message_id &&
      String(messageId) === String(current.current_message_id) &&
      incomingDeliveryCount != null &&
      previousDeliveryCount != null &&
      incomingDeliveryCount > previousDeliveryCount
    );

    const canAcquire = current.status === 'PENDING' || sameMessageRedelivery;
    if (!canAcquire) {
      await client.query(
        `INSERT INTO scan_attempts (
           attempt_id, scan_id, tenant_id, worker_name, servicebus_message_id,
           servicebus_delivery_count, status, metadata, started_at, completed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'SKIPPED', $7::jsonb, NOW(), NOW())
         ON CONFLICT (attempt_id) DO NOTHING`,
        [
          attemptId,
          scanId,
          tenantId,
          workerName || null,
          messageId || null,
          incomingDeliveryCount,
          JSON.stringify({ reason: 'SCAN_NOT_ACQUIRABLE', current })
        ]
      );
      return { acquired: false, current, reason: 'SCAN_NOT_ACQUIRABLE' };
    }

    if (sameMessageRedelivery) {
      await client.query(
        `UPDATE scan_attempts
            SET status = 'RETRYABLE',
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                completed_at = COALESCE(completed_at, NOW())
          WHERE attempt_id = $1 AND status = 'STARTED'`,
        [
          current.processing_attempt_id,
          JSON.stringify({
            reason: 'MESSAGE_REDELIVERED_AFTER_UNSETTLED_ATTEMPT',
            supersededByAttemptId: attemptId,
            previousDeliveryCount,
            incomingDeliveryCount
          })
        ]
      );
    }

    const update = await client.query(
      `UPDATE scans
          SET status = 'IN_PROGRESS',
              started_at = COALESCE(started_at, NOW()),
              updated_at = NOW(),
              error_message = NULL,
              error_code = NULL,
              error_correlation_id = NULL,
              processing_attempt_id = $3
        WHERE id = $1 AND tenant_id = $2
          AND (
            status = 'PENDING'
            OR (status = 'IN_PROGRESS' AND processing_attempt_id = $4)
          )
      RETURNING id, tenant_id, status`,
      [scanId, tenantId, attemptId, current.processing_attempt_id]
    );

    if (update.rowCount !== 1) {
      throw new Error('The scan attempt could not acquire the locked scan row.');
    }

    await client.query(
      `INSERT INTO scan_attempts (
         attempt_id, scan_id, tenant_id, worker_name, servicebus_message_id,
         servicebus_delivery_count, status, metadata, started_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'STARTED', $7::jsonb, NOW())`,
      [
        attemptId,
        scanId,
        tenantId,
        workerName || null,
        messageId || null,
        incomingDeliveryCount,
        JSON.stringify(sameMessageRedelivery ? {
          reclaimedFromAttemptId: current.processing_attempt_id,
          reason: 'MESSAGE_REDELIVERY_RECLAIM'
        } : {})
      ]
    );
    return { acquired: true, reclaimed: sameMessageRedelivery, previousAttemptId: current.processing_attempt_id || null };
  });
}

async function markResourcePreflight(pool, { scanId, tenantId, attemptId, resourceCount, resourceLimit }) {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const update = await client.query(
      `UPDATE scans
          SET resource_count = $1, resource_limit = $2, updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4
          AND processing_attempt_id = $5
          AND status = 'IN_PROGRESS'`,
      [resourceCount, resourceLimit, scanId, tenantId, attemptId]
    );
    return update.rowCount === 1;
  });
}

async function saveResult(client, { scanId, tenantId, result, maxResultBytes, compressionThresholdBytes }) {
  const sanitizedResult = sanitizeCustomerResult(result || null);
  const json = stringifyResult(sanitizedResult);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (maxResultBytes != null && bytes > maxResultBytes) {
    const error = new Error(`Result JSON exceeds MAX_RESULT_JSON_BYTES (${bytes}/${maxResultBytes}).`);
    error.code = 'RESULT_SIZE_LIMIT_EXCEEDED';
    throw error;
  }
  const summary = buildResultSummary(sanitizedResult);
  const sha = sha256Hex(json);
  if (compressionThresholdBytes != null && bytes > compressionThresholdBytes) {
    const compressed = zlib.gzipSync(Buffer.from(json, 'utf8')).toString('base64');
    await client.query(
      `INSERT INTO scan_results (scan_id, tenant_id, result_json, result_gzip_base64, compression, result_size_bytes, result_sha256, result_summary, created_at, updated_at)
       VALUES ($1, $2, NULL, $3, 'gzip_base64', $4, $5, $6::jsonb, NOW(), NOW())
       ON CONFLICT (scan_id) DO UPDATE
         SET result_json = NULL,
             result_gzip_base64 = EXCLUDED.result_gzip_base64,
             compression = 'gzip_base64',
             result_size_bytes = EXCLUDED.result_size_bytes,
             result_sha256 = EXCLUDED.result_sha256,
             result_summary = EXCLUDED.result_summary,
             updated_at = NOW()`,
      [scanId, tenantId, compressed, bytes, sha, JSON.stringify(summary)]
    );
  } else {
    await client.query(
      `INSERT INTO scan_results (scan_id, tenant_id, result_json, result_gzip_base64, compression, result_size_bytes, result_sha256, result_summary, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NULL, 'none', $4, $5, $6::jsonb, NOW(), NOW())
       ON CONFLICT (scan_id) DO UPDATE
         SET result_json = EXCLUDED.result_json,
             result_gzip_base64 = NULL,
             compression = 'none',
             result_size_bytes = EXCLUDED.result_size_bytes,
             result_sha256 = EXCLUDED.result_sha256,
             result_summary = EXCLUDED.result_summary,
             updated_at = NOW()`,
      [scanId, tenantId, json, bytes, sha, JSON.stringify(summary)]
    );
  }
  await client.query(
    'UPDATE scans SET result_size_bytes = $1, result_sha256 = $2 WHERE id = $3 AND tenant_id = $4',
    [bytes, sha, scanId, tenantId]
  );
}

async function transitionBillingState(client, { scanId, tenantId, targetState, eventType }) {
  const reserved = await client.query(
    `SELECT * FROM billing_usage_ledger
      WHERE scan_id = $1 AND tenant_id = $2 AND event_type = 'scan_reserved'
      ORDER BY recorded_at DESC LIMIT 1`,
    [scanId, tenantId]
  );
  if (reserved.rowCount !== 1) {
    await client.query(
      'UPDATE scans SET billing_state = $3, billing_error = $4, billing_state_updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
      [scanId, tenantId, targetState, 'Missing scan_reserved ledger entry']
    );
    return false;
  }
  const existing = await client.query(
    'SELECT 1 FROM billing_usage_ledger WHERE scan_id = $1 AND tenant_id = $2 AND event_type = $3 LIMIT 1',
    [scanId, tenantId, eventType]
  );
  if (existing.rowCount === 0) {
    const row = reserved.rows[0];
    const amount = eventType === 'scan_refunded' ? 0 : Number(row.amount_eur_ht || 0);
    await client.query(
      `INSERT INTO billing_usage_ledger (
         tenant_id, scan_id, event_type, plan_code_snapshot, quota_month,
         billing_units, unit_price_eur_ht, amount_eur_ht, currency_code,
         cloud_provider, scan_profile, modules, metadata, recorded_at
       ) VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, 'EUR', $9, $10, $11::jsonb, $12::jsonb, NOW())`,
      [tenantId, scanId, eventType, row.plan_code_snapshot, row.quota_month, row.billing_units, money(row.unit_price_eur_ht), money(amount), row.cloud_provider, row.scan_profile, JSON.stringify(row.modules || []), JSON.stringify({ ...(row.metadata || {}), billingState: targetState, source: 'worker-state-transition' })]
    );
  }
  await client.query(
    'UPDATE scans SET billing_state = $3, billing_error = NULL, billing_state_updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [scanId, tenantId, targetState]
  );
  return true;
}

async function markCompleted(pool, { scanId, tenantId, attemptId, result, maxResultBytes, compressionThresholdBytes }) {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const owned = await client.query(
      `SELECT 1
         FROM scans
        WHERE id = $1 AND tenant_id = $2
          AND processing_attempt_id = $3
          AND status = 'IN_PROGRESS'
        FOR UPDATE`,
      [scanId, tenantId, attemptId]
    );
    if (owned.rowCount !== 1) {
      await client.query(
        `UPDATE scan_attempts
            SET status = 'SKIPPED',
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                completed_at = COALESCE(completed_at, NOW())
          WHERE attempt_id = $1`,
        [attemptId, JSON.stringify({ reason: 'ATTEMPT_NO_LONGER_OWNS_SCAN' })]
      );
      return false;
    }

    await saveResult(client, { scanId, tenantId, result, maxResultBytes, compressionThresholdBytes });
    const update = await client.query(
      `UPDATE scans
          SET status = 'DONE', result = NULL, completed_at = NOW(), updated_at = NOW(),
              error_message = NULL, error_code = NULL, error_correlation_id = NULL
        WHERE id = $1 AND tenant_id = $2 AND processing_attempt_id = $3 AND status = 'IN_PROGRESS'`,
      [scanId, tenantId, attemptId]
    );
    if (update.rowCount !== 1) {
      const error = new Error('The scan attempt lost ownership while completing the result.');
      error.code = 'SCAN_ATTEMPT_OWNERSHIP_LOST';
      throw error;
    }
    await transitionBillingState(client, { scanId, tenantId, targetState: 'CONSUMED', eventType: 'scan_consumed' });
    await client.query(
      'UPDATE scan_attempts SET status = $1, completed_at = NOW() WHERE attempt_id = $2',
      ['COMPLETED', attemptId]
    );
    return true;
  });
}

async function markRetryable(pool, { scanId, tenantId, attemptId, errorCode, publicMessage, correlationId, metadata = {} }) {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const update = await client.query(
      `UPDATE scans
          SET status = 'PENDING', processing_attempt_id = NULL, updated_at = NOW(),
              error_message = $4, error_code = $5, error_correlation_id = $6
        WHERE id = $1 AND tenant_id = $2 AND processing_attempt_id = $3 AND status = 'IN_PROGRESS'`,
      [scanId, tenantId, attemptId, boundedText(publicMessage), boundedText(errorCode, 120), correlationId]
    );
    await client.query(
      `UPDATE scan_attempts
          SET status = $1, error_message = $2, error_code = $3,
              error_correlation_id = $4, metadata = metadata || $5::jsonb, completed_at = NOW()
        WHERE attempt_id = $6`,
      [update.rowCount === 1 ? 'RETRYABLE' : 'SKIPPED', boundedText(publicMessage), boundedText(errorCode, 120), correlationId, JSON.stringify(metadata || {}), attemptId]
    );
    return update.rowCount === 1;
  });
}

async function markFailed(pool, {
  scanId,
  tenantId,
  attemptId,
  errorMessage,
  errorCode = 'SCAN_FAILED',
  correlationId = null,
  result = null,
  attemptStatus = 'FAILED',
  maxResultBytes,
  compressionThresholdBytes
}) {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const owned = await client.query(
      `SELECT 1
         FROM scans
        WHERE id = $1 AND tenant_id = $2
          AND processing_attempt_id = $3
          AND status = 'IN_PROGRESS'
        FOR UPDATE`,
      [scanId, tenantId, attemptId]
    );
    if (owned.rowCount !== 1) {
      await client.query(
        `UPDATE scan_attempts
            SET status = 'SKIPPED',
                error_message = $2,
                error_code = $3,
                error_correlation_id = $4,
                metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
                completed_at = COALESCE(completed_at, NOW())
          WHERE attempt_id = $1`,
        [
          attemptId,
          boundedText(errorMessage),
          boundedText(errorCode, 120),
          correlationId,
          JSON.stringify({ reason: 'ATTEMPT_NO_LONGER_OWNS_SCAN' })
        ]
      );
      return false;
    }

    if (result) await saveResult(client, { scanId, tenantId, result, maxResultBytes, compressionThresholdBytes });
    const update = await client.query(
      `UPDATE scans
          SET status = 'FAILED', result = NULL, error_message = $4,
              error_code = $5, error_correlation_id = $6,
              updated_at = NOW(), completed_at = COALESCE(completed_at, NOW())
        WHERE id = $1 AND tenant_id = $2 AND processing_attempt_id = $3 AND status = 'IN_PROGRESS'`,
      [scanId, tenantId, attemptId, boundedText(errorMessage || 'Scan failed.'), boundedText(errorCode, 120), correlationId]
    );
    if (update.rowCount !== 1) {
      const error = new Error('The scan attempt lost ownership while persisting the terminal failure.');
      error.code = 'SCAN_ATTEMPT_OWNERSHIP_LOST';
      throw error;
    }
    await transitionBillingState(client, { scanId, tenantId, targetState: 'REFUNDED', eventType: 'scan_refunded' });
    await client.query(
      `UPDATE scan_attempts
          SET status = $1, error_message = $2, error_code = $3,
              error_correlation_id = $4, completed_at = NOW()
        WHERE attempt_id = $5`,
      [attemptStatus, boundedText(errorMessage), boundedText(errorCode, 120), correlationId, attemptId]
    );
    return true;
  });
}


async function markRejectedMessage(pool, {
  scanId,
  tenantId,
  attemptId,
  workerName,
  messageId,
  deliveryCount,
  errorCode,
  errorMessage,
  metadata = {},
  maxResultBytes,
  compressionThresholdBytes
}) {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const update = await client.query(
      `UPDATE scans
          SET status = 'FAILED', processing_attempt_id = NULL,
              error_message = $3, error_code = $4, error_correlation_id = $5,
              updated_at = NOW(), completed_at = COALESCE(completed_at, NOW())
        WHERE id = $1 AND tenant_id = $2 AND status = 'PENDING'
      RETURNING id`,
      [scanId, tenantId, boundedText(errorMessage), boundedText(errorCode, 120), attemptId]
    );

    if (update.rowCount !== 1) {
      const existing = await client.query(
        'SELECT status FROM scans WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [scanId, tenantId]
      );
      if (existing.rowCount === 1) {
        await client.query(
          `INSERT INTO scan_attempts (
             attempt_id, scan_id, tenant_id, worker_name, servicebus_message_id,
             servicebus_delivery_count, status, error_message, error_code,
             error_correlation_id, metadata, started_at, completed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'SKIPPED', $7, $8, $1, $9::jsonb, NOW(), NOW())
           ON CONFLICT (attempt_id) DO NOTHING`,
          [
            attemptId,
            scanId,
            tenantId,
            workerName || null,
            messageId || null,
            deliveryCount ?? null,
            boundedText(errorMessage),
            boundedText(errorCode, 120),
            JSON.stringify({
              ...(metadata || {}),
              reason: 'SCAN_NOT_PENDING',
              current: existing.rows[0]
            })
          ]
        );
      }
      return false;
    }

    const result = {
      durationMs: 0,
      error: {
        code: boundedText(errorCode, 120),
        message: boundedText(errorMessage),
        correlationId: attemptId,
        retryable: false
      },
      kpiScorecard: null
    };
    await saveResult(client, {
      scanId,
      tenantId,
      result,
      maxResultBytes,
      compressionThresholdBytes
    });
    await transitionBillingState(client, {
      scanId,
      tenantId,
      targetState: 'REFUNDED',
      eventType: 'scan_refunded'
    });
    await client.query(
      `INSERT INTO scan_attempts (
         attempt_id, scan_id, tenant_id, worker_name, servicebus_message_id,
         servicebus_delivery_count, status, error_message, error_code,
         error_correlation_id, metadata, started_at, completed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'DEAD_LETTERED', $7, $8, $1, $9::jsonb, NOW(), NOW())
       ON CONFLICT (attempt_id) DO NOTHING`,
      [
        attemptId,
        scanId,
        tenantId,
        workerName || null,
        messageId || null,
        deliveryCount ?? null,
        boundedText(errorMessage),
        boundedText(errorCode, 120),
        JSON.stringify(metadata || {})
      ]
    );
    return true;
  });
}

module.exports = {
  beginAttempt,
  markResourcePreflight,
  markCompleted,
  markRetryable,
  markFailed,
  markRejectedMessage,
  saveResult,
  buildResultSummary,
  transitionBillingState
};
