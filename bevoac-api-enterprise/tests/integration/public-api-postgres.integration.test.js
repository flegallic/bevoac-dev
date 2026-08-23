'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');

const enabled = process.env.BEVOAC_INTEGRATION_DB === '1';
const integrationTest = enabled ? test : test.skip;

integrationTest('public API authenticates with bevoac_api and preserves tenant isolation', async () => {
  process.env.NODE_ENV = 'test';
  process.env.APP_RUNTIME_MODE = 'public_api';
  process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
  process.env.OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST = 'false';
  process.env.PG_SSL_MODE = 'disable';
  process.env.APIM_BACKEND_BOUNDARY_REQUIRED = 'false';
  process.env.API_PUBLIC_BASE_URL = 'https://api.integration.invalid';
  process.env.ONBOARDING_REDIRECT_URI = 'https://api.integration.invalid/v1/onboarding/azure/callback';
  process.env.ONBOARDING_FRONTEND_SUCCESS_URL = 'https://frontend.integration.invalid/success';
  process.env.ONBOARDING_STATE_SECRET = 'integration-state-secret-'.repeat(4);
  process.env.MICROSOFT_CLIENT_ID = '00000000-0000-4000-8000-000000000001';
  process.env.MICROSOFT_CLIENT_SECRET = 'integration-not-a-real-secret';
  process.env.ALLOWED_ORIGINS = 'https://frontend.integration.invalid';
  process.env.LOG_LEVEL = 'silent';

  const { buildServer } = require('../../src/server');
  const app = await buildServer();
  const apiKey = process.env.BEVOAC_CI_API_KEY;
  assert.ok(apiKey, 'BEVOAC_CI_API_KEY is required');

  try {
    const health = await app.inject({ method: 'GET', url: '/v1/health' });
    assert.equal(health.statusCode, 200);

    const invalid = await app.inject({
      method: 'GET',
      url: '/v1/scans',
      headers: { authorization: 'Bearer invalid-integration-key' }
    });
    assert.equal(invalid.statusCode, 401);

    const list = await app.inject({
      method: 'GET',
      url: '/v1/scans?limit=50&offset=0',
      headers: { authorization: `Bearer ${apiKey}` }
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.match(list.body, /31111111-1111-4111-8111-111111111111/);
    assert.doesNotMatch(list.body, /32222222-2222-4222-8222-222222222222/);

    const crossTenant = await app.inject({
      method: 'GET',
      url: '/v1/scans/32222222-2222-4222-8222-222222222222',
      headers: { authorization: `Bearer ${apiKey}` }
    });
    assert.equal(crossTenant.statusCode, 404, crossTenant.body);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/scans',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': 'ci-public-api-outbox-v6-2-0'
      },
      payload: {
        cloudProvider: 'azure',
        scanProfile: 'web',
        modules: ['web'],
        azure: { targetUrl: 'https://tenant-a.rls.local.invalid' }
      }
    });
    assert.equal(create.statusCode, 201, create.body);
    const created = create.json();
    assert.equal(created.status, 'PENDING');
    assert.equal(created.billingState, 'RESERVED');
    assert.ok(created.scanId);

    const admin = new Client({
      host: process.env.PG_HOST,
      port: Number(process.env.PG_PORT || 5432),
      database: process.env.PG_DATABASE,
      user: process.env.PG_ADMIN_USER,
      password: process.env.PG_ADMIN_PASSWORD,
      ssl: false
    });
    await admin.connect();
    try {
      const durable = await admin.query(
        `SELECT count(*)::int AS count
           FROM public.outbox_events
          WHERE aggregate_id = $1::uuid
            AND tenant_id = $2::uuid
            AND status = 'PENDING'`,
        [created.scanId, '11111111-1111-4111-8111-111111111111']
      );
      assert.equal(durable.rows[0].count, 1);
    } finally {
      await admin.end();
    }
  } finally {
    await app.close();
  }
});
