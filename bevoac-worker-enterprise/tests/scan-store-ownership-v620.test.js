'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  beginAttempt,
  markResourcePreflight,
  markCompleted,
  markFailed,
  markRejectedMessage
} = require('../src/services/scan-store');

const scanId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const oldAttemptId = '33333333-3333-4333-8333-333333333333';
const newAttemptId = '44444444-4444-4444-8444-444444444444';

function makePool(handler) {
  const calls = [];
  const releases = [];
  const client = {
    async query(text, values = []) {
      const sql = String(text);
      calls.push({ sql, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rowCount: 0, rows: [] };
      if (sql.includes("set_config('app.current_tenant_id'")) return { rowCount: 1, rows: [{}] };
      return handler(sql, values, calls);
    },
    release(error) {
      releases.push(error || null);
    }
  };
  return {
    calls,
    releases,
    async connect() { return client; }
  };
}

test('redelivery of the same Service Bus message reclaims an interrupted attempt', async () => {
  const pool = makePool((sql) => {
    if (sql.includes('FROM scans s') && sql.includes('FOR UPDATE OF s')) {
      return {
        rowCount: 1,
        rows: [{
          status: 'IN_PROGRESS',
          processing_attempt_id: oldAttemptId,
          current_message_id: 'message-1',
          current_delivery_count: 1,
          current_attempt_status: 'STARTED'
        }]
      };
    }
    if (sql.includes("SET status = 'RETRYABLE'")) return { rowCount: 1, rows: [] };
    if (sql.includes("SET status = 'IN_PROGRESS'")) return { rowCount: 1, rows: [{ id: scanId, tenant_id: tenantId, status: 'IN_PROGRESS' }] };
    if (sql.includes('INSERT INTO scan_attempts')) return { rowCount: 1, rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  const result = await beginAttempt(pool, {
    scanId,
    tenantId,
    attemptId: newAttemptId,
    workerName: 'worker-1',
    messageId: 'message-1',
    deliveryCount: 2
  });

  assert.equal(result.acquired, true);
  assert.equal(result.reclaimed, true);
  assert.equal(result.previousAttemptId, oldAttemptId);
  assert.ok(pool.calls.some(({ values }) => values.some((value) => String(value).includes('MESSAGE_REDELIVERED_AFTER_UNSETTLED_ATTEMPT'))));
  assert.deepEqual(pool.releases, [null]);
});

test('a stale attempt cannot overwrite the result of the current owner', async () => {
  const pool = makePool((sql) => {
    if (sql.includes('SELECT 1') && sql.includes('FOR UPDATE')) return { rowCount: 0, rows: [] };
    if (sql.includes("SET status = 'SKIPPED'")) return { rowCount: 1, rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  const changed = await markCompleted(pool, {
    scanId,
    tenantId,
    attemptId: oldAttemptId,
    result: { secret: 'must-not-be-written' },
    maxResultBytes: 100000,
    compressionThresholdBytes: 1000
  });

  assert.equal(changed, false);
  assert.equal(pool.calls.some(({ sql }) => sql.includes('INSERT INTO scan_results')), false);
});

test('a stale attempt cannot persist a terminal failure or refund billing', async () => {
  const pool = makePool((sql) => {
    if (sql.includes('SELECT 1') && sql.includes('FOR UPDATE')) return { rowCount: 0, rows: [] };
    if (sql.includes("SET status = 'SKIPPED'")) return { rowCount: 1, rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  const changed = await markFailed(pool, {
    scanId,
    tenantId,
    attemptId: oldAttemptId,
    errorMessage: 'failure',
    result: { error: true },
    maxResultBytes: 100000,
    compressionThresholdBytes: 1000
  });

  assert.equal(changed, false);
  assert.equal(pool.calls.some(({ sql }) => sql.includes('INSERT INTO scan_results')), false);
  assert.equal(pool.calls.some(({ sql }) => sql.includes('billing_usage_ledger')), false);
});

test('resource preflight updates only the owning attempt', async () => {
  const pool = makePool((sql, values) => {
    if (sql.includes('UPDATE scans') && sql.includes('resource_count')) {
      assert.deepEqual(values, [12, 50, scanId, tenantId, newAttemptId]);
      assert.match(sql, /processing_attempt_id = \$5/);
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  const changed = await markResourcePreflight(pool, {
    scanId,
    tenantId,
    attemptId: newAttemptId,
    resourceCount: 12,
    resourceLimit: 50
  });

  assert.equal(changed, true);
});


test('completion ownership loss after result persistence rolls back the whole transaction', async () => {
  let resultInsertSeen = false;
  const pool = makePool((sql) => {
    if (sql.includes('SELECT 1') && sql.includes('FOR UPDATE')) return { rowCount: 1, rows: [{}] };
    if (sql.includes('INSERT INTO scan_results')) {
      resultInsertSeen = true;
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('UPDATE scans SET result_size_bytes')) return { rowCount: 1, rows: [] };
    if (sql.includes("SET status = 'DONE'")) return { rowCount: 0, rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  await assert.rejects(
    () => markCompleted(pool, {
      scanId,
      tenantId,
      attemptId: newAttemptId,
      result: { ok: true },
      maxResultBytes: 100000,
      compressionThresholdBytes: 1000
    }),
    (error) => error.code === 'SCAN_ATTEMPT_OWNERSHIP_LOST'
  );

  assert.equal(resultInsertSeen, true);
  assert.equal(pool.calls.some(({ sql }) => sql === 'ROLLBACK'), true);
  assert.equal(pool.calls.some(({ sql }) => sql === 'COMMIT'), false);
});

test('terminal ownership loss after result persistence rolls back before billing refund', async () => {
  const pool = makePool((sql) => {
    if (sql.includes('SELECT 1') && sql.includes('FOR UPDATE')) return { rowCount: 1, rows: [{}] };
    if (sql.includes('INSERT INTO scan_results')) return { rowCount: 1, rows: [] };
    if (sql.includes('UPDATE scans SET result_size_bytes')) return { rowCount: 1, rows: [] };
    if (sql.includes("SET status = 'FAILED'")) return { rowCount: 0, rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  await assert.rejects(
    () => markFailed(pool, {
      scanId,
      tenantId,
      attemptId: newAttemptId,
      errorMessage: 'terminal',
      result: { error: true },
      maxResultBytes: 100000,
      compressionThresholdBytes: 1000
    }),
    (error) => error.code === 'SCAN_ATTEMPT_OWNERSHIP_LOST'
  );

  assert.equal(pool.calls.some(({ sql }) => sql === 'ROLLBACK'), true);
  assert.equal(pool.calls.some(({ sql }) => sql.includes('billing_usage_ledger')), false);
});


test('invalid queued message terminalizes the pending scan, refunds billing and records dead-letter evidence atomically', async () => {
  const pool = makePool((sql) => {
    if (sql.includes("SET status = 'FAILED', processing_attempt_id = NULL")) {
      return { rowCount: 1, rows: [{ id: scanId }] };
    }
    if (sql.includes('INSERT INTO scan_results')) return { rowCount: 1, rows: [] };
    if (sql.includes('UPDATE scans SET result_size_bytes')) return { rowCount: 1, rows: [] };
    if (sql.includes("event_type = 'scan_reserved'")) {
      return {
        rowCount: 1,
        rows: [{
          plan_code_snapshot: 'standard',
          quota_month: '2026-08-01',
          billing_units: 1,
          unit_price_eur_ht: 1,
          amount_eur_ht: 1,
          cloud_provider: 'azure',
          scan_profile: 'default',
          modules: ['web'],
          metadata: {}
        }]
      };
    }
    if (sql.includes('SELECT 1 FROM billing_usage_ledger')) return { rowCount: 0, rows: [] };
    if (sql.includes('INSERT INTO billing_usage_ledger')) return { rowCount: 1, rows: [] };
    if (sql.includes('UPDATE scans SET billing_state')) return { rowCount: 1, rows: [] };
    if (sql.includes('INSERT INTO scan_attempts') && sql.includes("'DEAD_LETTERED'")) return { rowCount: 1, rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  const changed = await markRejectedMessage(pool, {
    scanId,
    tenantId,
    attemptId: newAttemptId,
    workerName: 'worker-1',
    messageId: 'invalid-message',
    deliveryCount: 1,
    errorCode: 'INVALID_SCAN_REQUEST',
    errorMessage: 'The queued scan request failed contract validation.',
    metadata: { validationErrors: [{ keyword: 'required' }] },
    maxResultBytes: 100000,
    compressionThresholdBytes: 1000
  });

  assert.equal(changed, true);
  assert.equal(pool.calls.some(({ sql }) => sql.includes('INSERT INTO scan_results')), true);
  assert.equal(pool.calls.some(({ sql }) => sql.includes('INSERT INTO billing_usage_ledger')), true);
  assert.equal(pool.calls.some(({ sql }) => sql.includes("'DEAD_LETTERED'")), true);
  assert.equal(pool.calls.some(({ sql }) => sql === 'COMMIT'), true);
});

test('invalid queued message does not alter an already-running or settled scan', async () => {
  const pool = makePool((sql) => {
    if (sql.includes("SET status = 'FAILED', processing_attempt_id = NULL")) return { rowCount: 0, rows: [] };
    if (sql.includes('SELECT status FROM scans')) return { rowCount: 1, rows: [{ status: 'DONE' }] };
    if (sql.includes('INSERT INTO scan_attempts') && sql.includes("'SKIPPED'")) return { rowCount: 1, rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  const changed = await markRejectedMessage(pool, {
    scanId,
    tenantId,
    attemptId: newAttemptId,
    workerName: 'worker-1',
    messageId: 'invalid-message',
    deliveryCount: 1,
    errorCode: 'INVALID_SCAN_REQUEST',
    errorMessage: 'The queued scan request failed contract validation.',
    maxResultBytes: 100000,
    compressionThresholdBytes: 1000
  });

  assert.equal(changed, false);
  assert.equal(pool.calls.some(({ sql }) => sql.includes('INSERT INTO scan_results')), false);
  assert.equal(pool.calls.some(({ sql }) => sql.includes('billing_usage_ledger')), false);
});
