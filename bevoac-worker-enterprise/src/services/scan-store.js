const crypto = require('crypto');
const zlib = require('zlib');
const { buildResultSummary } = require('../lib/findings-collector');
const { setTenantContext } = require('../lib/db-context');

function stringifyResult(result) { return JSON.stringify(result || null); }
function sha256Hex(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function money(value) { return Number(Number(value || 0).toFixed(2)); }

async function beginAttempt(pool, { scanId, tenantId, attemptId, workerName, messageId, deliveryCount }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, tenantId, { local: true });
    const update = await client.query(
      `UPDATE scans SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, NOW()), updated_at = NOW(), error_message = NULL, processing_attempt_id = $3 WHERE id = $1 AND tenant_id = $2 AND status = 'PENDING' RETURNING id, tenant_id, status`,
      [scanId, tenantId, attemptId]
    );
    if (update.rowCount !== 1) {
      const existing = await client.query('SELECT status, processing_attempt_id FROM scans WHERE id = $1 AND tenant_id = $2 LIMIT 1', [scanId, tenantId]);
      await client.query(
        `INSERT INTO scan_attempts (attempt_id, scan_id, tenant_id, worker_name, servicebus_message_id, servicebus_delivery_count, status, metadata, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'SKIPPED', $7::jsonb, NOW(), NOW()) ON CONFLICT (attempt_id) DO NOTHING`,
        [attemptId, scanId, tenantId, workerName || null, messageId || null, deliveryCount || null, JSON.stringify({ reason: 'SCAN_NOT_PENDING', current: existing.rows[0] || null })]
      );
      await client.query('COMMIT');
      return { acquired: false, current: existing.rows[0] || null };
    }
    await client.query(
      `INSERT INTO scan_attempts (attempt_id, scan_id, tenant_id, worker_name, servicebus_message_id, servicebus_delivery_count, status, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'STARTED', NOW()) ON CONFLICT (attempt_id) DO NOTHING`,
      [attemptId, scanId, tenantId, workerName || null, messageId || null, deliveryCount || null]
    );
    await client.query('COMMIT');
    return { acquired: true };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}

async function markResourcePreflight(pool, scanId, tenantId, resourceCount, resourceLimit) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, tenantId, { local: true });
    await client.query(`UPDATE scans SET resource_count = $1, resource_limit = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4 AND status = 'IN_PROGRESS'`, [resourceCount, resourceLimit, scanId, tenantId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}

async function saveResult(client, { scanId, tenantId, result, maxResultBytes, compressionThresholdBytes }) {
  const json = stringifyResult(result);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (maxResultBytes != null && bytes > maxResultBytes) throw new Error(`Result JSON exceeds MAX_RESULT_JSON_BYTES (${bytes}/${maxResultBytes}).`);
  const summary = buildResultSummary(result);
  const sha = sha256Hex(json);
  if (compressionThresholdBytes != null && bytes > compressionThresholdBytes) {
    const compressed = zlib.gzipSync(Buffer.from(json, 'utf8')).toString('base64');
    await client.query(
      `INSERT INTO scan_results (scan_id, tenant_id, result_json, result_gzip_base64, compression, result_size_bytes, result_sha256, result_summary, created_at, updated_at)
       VALUES ($1, $2, NULL, $3, 'gzip_base64', $4, $5, $6::jsonb, NOW(), NOW())
       ON CONFLICT (scan_id) DO UPDATE SET result_json = NULL, result_gzip_base64 = EXCLUDED.result_gzip_base64, compression = 'gzip_base64', result_size_bytes = EXCLUDED.result_size_bytes, result_sha256 = EXCLUDED.result_sha256, result_summary = EXCLUDED.result_summary, updated_at = NOW()`,
      [scanId, tenantId, compressed, bytes, sha, JSON.stringify(summary)]
    );
  } else {
    await client.query(
      `INSERT INTO scan_results (scan_id, tenant_id, result_json, result_gzip_base64, compression, result_size_bytes, result_sha256, result_summary, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NULL, 'none', $4, $5, $6::jsonb, NOW(), NOW())
       ON CONFLICT (scan_id) DO UPDATE SET result_json = EXCLUDED.result_json, result_gzip_base64 = NULL, compression = 'none', result_size_bytes = EXCLUDED.result_size_bytes, result_sha256 = EXCLUDED.result_sha256, result_summary = EXCLUDED.result_summary, updated_at = NOW()`,
      [scanId, tenantId, json, bytes, sha, JSON.stringify(summary)]
    );
  }
  await client.query('UPDATE scans SET result_size_bytes = $1, result_sha256 = $2 WHERE id = $3 AND tenant_id = $4', [bytes, sha, scanId, tenantId]);
}

async function transitionBillingState(client, { scanId, tenantId, targetState, eventType }) {
  const reserved = await client.query(`SELECT * FROM billing_usage_ledger WHERE scan_id = $1 AND tenant_id = $2 AND event_type = 'scan_reserved' ORDER BY recorded_at DESC LIMIT 1`, [scanId, tenantId]);
  if (reserved.rowCount !== 1) {
    await client.query(`UPDATE scans SET billing_state = $3, billing_error = $4, billing_state_updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [scanId, tenantId, targetState, 'Missing scan_reserved ledger entry']);
    return false;
  }
  const existing = await client.query(`SELECT 1 FROM billing_usage_ledger WHERE scan_id = $1 AND tenant_id = $2 AND event_type = $3 LIMIT 1`, [scanId, tenantId, eventType]);
  if (existing.rowCount === 0) {
    const row = reserved.rows[0];
    const amount = eventType === 'scan_refunded' ? 0 : Number(row.amount_eur_ht || 0);
    await client.query(
      `INSERT INTO billing_usage_ledger (tenant_id, scan_id, event_type, plan_code_snapshot, quota_month, billing_units, unit_price_eur_ht, amount_eur_ht, currency_code, cloud_provider, scan_profile, modules, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, 'EUR', $9, $10, $11::jsonb, $12::jsonb, NOW())`,
      [tenantId, scanId, eventType, row.plan_code_snapshot, row.quota_month, row.billing_units, money(row.unit_price_eur_ht), money(amount), row.cloud_provider, row.scan_profile, JSON.stringify(row.modules || []), JSON.stringify({ ...(row.metadata || {}), billingState: targetState, source: 'worker-state-transition' })]
    );
  }
  await client.query(`UPDATE scans SET billing_state = $3, billing_error = NULL, billing_state_updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [scanId, tenantId, targetState]);
  return true;
}

async function markCompleted(pool, { scanId, tenantId, attemptId, result, maxResultBytes, compressionThresholdBytes }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, tenantId, { local: true });
    await saveResult(client, { scanId, tenantId, result, maxResultBytes, compressionThresholdBytes });
    const update = await client.query(`UPDATE scans SET status = 'DONE', result = NULL, completed_at = NOW(), updated_at = NOW(), error_message = NULL WHERE id = $1 AND tenant_id = $2 AND processing_attempt_id = $3 AND status = 'IN_PROGRESS'`, [scanId, tenantId, attemptId]);
    if (update.rowCount === 1) await transitionBillingState(client, { scanId, tenantId, targetState: 'CONSUMED', eventType: 'scan_consumed' });
    await client.query(`UPDATE scan_attempts SET status = $1, completed_at = NOW() WHERE attempt_id = $2`, [update.rowCount === 1 ? 'COMPLETED' : 'SKIPPED', attemptId]);
    await client.query('COMMIT');
    return update.rowCount === 1;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}

async function markFailed(pool, { scanId, tenantId, attemptId, errorMessage, result = null, maxResultBytes, compressionThresholdBytes }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, tenantId, { local: true });
    if (result) await saveResult(client, { scanId, tenantId, result, maxResultBytes, compressionThresholdBytes });
    const update = await client.query(`UPDATE scans SET status = 'FAILED', result = NULL, error_message = $4, updated_at = NOW(), completed_at = COALESCE(completed_at, NOW()) WHERE id = $1 AND tenant_id = $2 AND processing_attempt_id = $3 AND status = 'IN_PROGRESS'`, [scanId, tenantId, attemptId, String(errorMessage || 'Worker failure').slice(0, 4000)]);
    if (update.rowCount === 1) await transitionBillingState(client, { scanId, tenantId, targetState: 'REFUNDED', eventType: 'scan_refunded' });
    await client.query(`UPDATE scan_attempts SET status = $1, error_message = $2, completed_at = NOW() WHERE attempt_id = $3`, [update.rowCount === 1 ? 'FAILED' : 'SKIPPED', String(errorMessage || '').slice(0, 4000), attemptId]);
    await client.query('COMMIT');
    return update.rowCount === 1;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}
module.exports = { beginAttempt, markResourcePreflight, markCompleted, markFailed, buildResultSummary, transitionBillingState };
