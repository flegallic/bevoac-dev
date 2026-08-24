'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTenantTransaction } = require('../src/lib/db-context');

const TENANT = '11111111-1111-4111-8111-111111111111';

function fakePool() {
  const queries = [];
  const releases = [];
  const client = {
    async query(text, values = []) {
      queries.push({ text: String(text), values });
      return { rowCount: 0, rows: [] };
    },
    release(error) { releases.push(error || null); }
  };
  return {
    queries,
    releases,
    async connect() { return client; }
  };
}

test('worker tenant context is transaction-local', async () => {
  const pool = fakePool();
  await withTenantTransaction(pool, TENANT, async (client) => {
    await client.query('SELECT 1');
  });
  assert.deepEqual(pool.queries.map((item) => item.text), [
    'BEGIN',
    "SELECT set_config('app.current_tenant_id', $1, $2)",
    'SELECT 1',
    'COMMIT'
  ]);
  assert.deepEqual(pool.releases, [null]);
});

test('worker destroys a connection that fails inside a tenant transaction', async () => {
  const pool = fakePool();
  const error = Object.assign(new Error('connection failure'), { code: '08006' });
  await assert.rejects(
    () => withTenantTransaction(pool, TENANT, async () => { throw error; }),
    (received) => received === error
  );
  assert.equal(pool.releases[0], error);
});
