'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONNECTION_ERROR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT',
  '08000', '08003', '08006', '08001', '08004', '08007', '08P01',
  '57P01', '57P02', '57P03'
]);

function isConnectionFailure(error) {
  const code = String(error?.code || '').toUpperCase();
  return CONNECTION_ERROR_CODES.has(code) || code.startsWith('08');
}

function assertTenantId(tenantId) {
  const value = String(tenantId || '').trim().toLowerCase();
  if (!UUID_RE.test(value)) throw new Error('Invalid tenantId for database context.');
  return value;
}

async function setTenantContext(client, tenantId, { local = true } = {}) {
  const value = assertTenantId(tenantId);
  await client.query(`SELECT set_config('app.current_tenant_id', $1, $2)`, [value, Boolean(local)]);
}


function releaseClient(client, releaseError = null) {
  if (!client || typeof client.release !== 'function') return;
  client.release(releaseError || undefined);
}

async function rollbackTransaction(client) {
  try {
    await client.query('ROLLBACK');
    return null;
  } catch (error) {
    return error;
  }
}

async function withDatabaseTransaction(pool, fn) {
  const client = await pool.connect();
  let transactionStarted = false;
  let releaseError = null;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const result = await fn(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (error) {
    if (isConnectionFailure(error)) {
      releaseError = error;
    }
    if (transactionStarted) {
      const rollbackError = await rollbackTransaction(client);
      if (rollbackError) {
        releaseError = rollbackError;
        error.rollbackError = rollbackError;
      }
    }
    throw error;
  } finally {
    releaseClient(client, releaseError);
  }
}

async function withTenantSession(pool, tenantId, fn) {
  return withTenantTransaction(pool, tenantId, fn);
}

async function withTenantTransaction(pool, tenantId, fn) {
  const normalizedTenantId = assertTenantId(tenantId);
  return withDatabaseTransaction(pool, async (client) => {
    await setTenantContext(client, normalizedTenantId, { local: true });
    return fn(client);
  });
}

module.exports = {
  CONNECTION_ERROR_CODES,
  isConnectionFailure,
  assertTenantId,
  setTenantContext,
  releaseClient,
  withDatabaseTransaction,
  withTenantSession,
  withTenantTransaction,
};
