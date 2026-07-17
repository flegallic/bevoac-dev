'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  lookupApiKeyPrincipal
} = require('../../src/services/api-key-auth-service');

class FakePool {
  constructor(result) {
    this.result = result;
    this.calls = [];
  }

  async query(sql, params) {
    this.calls.push({ sql, params });
    return this.result;
  }
}

test('API authentication uses only the restricted database function', async () => {
  const keyHash = 'a'.repeat(64);
  const pool = new FakePool({
    rowCount: 1,
    rows: [{
      api_key_id: '11111111-1111-4111-8111-111111111111',
      tenant_id: '22222222-2222-4222-8222-222222222222',
      scopes: ['scan:read']
    }]
  });

  const principal = await lookupApiKeyPrincipal(pool, keyHash);

  assert.equal(pool.calls.length, 1);
  assert.match(
    pool.calls[0].sql,
    /public\.bevoac_authenticate_api_key/
  );
  assert.doesNotMatch(pool.calls[0].sql, /\bFROM\s+api_keys\b/i);
  assert.doesNotMatch(pool.calls[0].sql, /\bJOIN\s+tenants\b/i);
  assert.deepEqual(pool.calls[0].params, [keyHash]);

  assert.deepEqual(principal, {
    apiKeyId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    scopes: ['scan:read']
  });
});

test('unknown API-key hash returns no principal', async () => {
  const pool = new FakePool({
    rowCount: 0,
    rows: []
  });

  const principal = await lookupApiKeyPrincipal(pool, 'b'.repeat(64));

  assert.equal(principal, null);
});

test('authentication SQL is bound to the real PostgreSQL login role', () => {
  const migrationPath = path.join(
    __dirname,
    '../../migrations/optional/' +
      '202607160002_secure_api_key_auth_boundary.sql'
  );

  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /SECURITY DEFINER/i);
  assert.match(sql, /SET search_path = pg_catalog/i);
  assert.match(sql, /session_user <> 'bevoac_api'/i);
  assert.match(
    sql,
    /REVOKE ALL[\s\S]*FROM PUBLIC/i
  );
  assert.match(
    sql,
    /GRANT EXECUTE[\s\S]*TO bevoac_api/i
  );
  assert.doesNotMatch(sql, /app\.service_context/i);
});

test('API authentication plugin no longer uses service context bypass', () => {
  const pluginPath = path.join(
    __dirname,
    '../../src/plugins/auth-api-key.js'
  );

  const source = fs.readFileSync(pluginPath, 'utf8');

  assert.doesNotMatch(source, /withServiceSession/);
  assert.doesNotMatch(source, /bevoac_auth_service/);
  assert.doesNotMatch(source, /\bFROM\s+api_keys\b/i);
  assert.doesNotMatch(source, /\bJOIN\s+tenants\b/i);
});
