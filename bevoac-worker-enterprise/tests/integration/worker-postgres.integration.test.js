'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const enabled = process.env.BEVOAC_INTEGRATION_DB === '1';
const integrationTest = enabled ? test : test.skip;

integrationTest('worker runtime persists a controlled failure with bevoac_worker', async () => {
  process.env.PG_SSL_MODE = process.env.PG_SSL_MODE || 'disable';
  const { buildPgPool } = require('../../src/lib/postgres');
  const { setTenantContext } = require('../../src/lib/db-context');
  const { beginAttempt, markFailed } = require('../../src/services/scan-store');

  const config = {
    workerName: 'bevoac-worker-ci',
    postgres: {
      host: process.env.PG_HOST,
      port: Number(process.env.PG_PORT || 5432),
      database: process.env.PG_DATABASE,
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      max: 4,
      ssl: false
    }
  };
  const pool = buildPgPool(config);
  const scanId = '35555555-5555-4555-8555-555555555555';
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const attemptId = '55555555-5555-4555-8555-555555555555';

  try {
    const started = await beginAttempt(pool, {
      scanId,
      tenantId,
      attemptId,
      workerName: 'ci-worker',
      messageId: 'ci-message',
      deliveryCount: 1
    });
    assert.equal(started.acquired, true);

    await markFailed(pool, {
      scanId,
      tenantId,
      attemptId,
      errorMessage: 'controlled CI failure',
      result: { error: 'controlled CI failure' },
      maxResultBytes: 1024 * 1024,
      compressionThresholdBytes: 512 * 1024
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setTenantContext(client, tenantId, { local: true });
      const result = await client.query(
        'SELECT status, billing_state FROM scans WHERE id = $1 AND tenant_id = $2',
        [scanId, tenantId]
      );
      assert.equal(result.rowCount, 1);
      assert.equal(result.rows[0].status, 'FAILED');
      assert.equal(result.rows[0].billing_state, 'REFUNDED');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});
