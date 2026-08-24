'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  withDatabaseSession,
  withTenantSession,
  withTenantTransaction
} = require('../../src/lib/db-context');

const TENANT_A = '11111111-1111-4111-8111-111111111111';

function fakePool({ failRollback = false } = {}) {
  const queries = [];
  const releases = [];
  const client = {
    async query(text, values = []) {
      queries.push({ text: String(text), values });
      if (String(text) === 'ROLLBACK' && failRollback) {
        throw new Error('rollback failed');
      }
      return { rowCount: 0, rows: [] };
    },
    release(error) {
      releases.push(error || null);
    }
  };
  return {
    queries,
    releases,
    async connect() {
      return client;
    }
  };
}

test('tenant session is transaction-local and cannot leak into the pool', async () => {
  const pool = fakePool();
  const result = await withTenantSession(pool, TENANT_A, async (client) => {
    await client.query('SELECT 42');
    return 42;
  });

  assert.equal(result, 42);
  assert.deepEqual(
    pool.queries.map((item) => item.text),
    [
      'BEGIN',
      "SELECT set_config('app.current_tenant_id', $1, $2)",
      'SELECT 42',
      'COMMIT'
    ]
  );
  assert.deepEqual(pool.queries[1].values, [TENANT_A, true]);
  assert.deepEqual(pool.releases, [null]);
});

test('failed rollback removes the client from the pool', async () => {
  const pool = fakePool({ failRollback: true });
  const original = new Error('application failure');

  await assert.rejects(
    () => withTenantTransaction(pool, TENANT_A, async () => {
      throw original;
    }),
    (error) => {
      assert.equal(error, original);
      assert.match(error.rollbackError.message, /rollback failed/);
      return true;
    }
  );

  assert.equal(pool.releases.length, 1);
  assert.match(pool.releases[0].message, /rollback failed/);
});


test('ordinary application errors do not destroy a healthy pooled client', async () => {
  const pool = fakePool();
  const applicationError = new Error('validation failed');

  await assert.rejects(
    () => withDatabaseSession(pool, async () => { throw applicationError; }),
    (error) => error === applicationError
  );

  assert.deepEqual(pool.releases, [null]);
});

test('connection-level errors destroy the pooled client', async () => {
  const pool = fakePool();
  const connectionError = Object.assign(new Error('connection reset'), {
    code: 'ECONNRESET'
  });

  await assert.rejects(
    () => withDatabaseSession(pool, async () => { throw connectionError; }),
    (error) => error === connectionError
  );

  assert.equal(pool.releases.length, 1);
  assert.equal(pool.releases[0], connectionError);
});


test('connection failure inside a transaction destroys the client even when rollback succeeds', async () => {
  const pool = fakePool();
  const connectionError = Object.assign(new Error('connection lost during query'), {
    code: '08006'
  });

  await assert.rejects(
    () => withTenantTransaction(pool, TENANT_A, async () => { throw connectionError; }),
    (error) => error === connectionError
  );

  assert.deepEqual(
    pool.queries.map((item) => item.text),
    ['BEGIN', "SELECT set_config('app.current_tenant_id', $1, $2)", 'ROLLBACK']
  );
  assert.equal(pool.releases[0], connectionError);
});
