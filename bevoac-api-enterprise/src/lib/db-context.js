'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE_CONTEXTS = new Set([
  'bevoac_auth_service',
  'bevoac_api_service',
  'bevoac_worker_service',
  'bevoac_outbox_service',
  'bevoac_retention_service',
  'bevoac_admin_service'
]);

function assertTenantId(tenantId) {
  const value = String(tenantId || '').trim().toLowerCase();
  if (!UUID_RE.test(value)) throw new Error('Invalid tenantId for database context.');
  return value;
}

function assertServiceContext(serviceContext) {
  const value = String(serviceContext || '').trim();
  if (!SERVICE_CONTEXTS.has(value)) throw new Error(`Unsupported database service context: ${serviceContext}`);
  return value;
}

async function setTenantContext(client, tenantId, { local = true } = {}) {
  const value = assertTenantId(tenantId);
  await client.query(`SELECT set_config('app.current_tenant_id', $1, $2), set_config('app.service_context', '', $2)`, [value, Boolean(local)]);
}

async function setServiceContext(client, serviceContext, { local = true } = {}) {
  const value = assertServiceContext(serviceContext);
  await client.query(`SELECT set_config('app.service_context', $1, $2), set_config('app.current_tenant_id', '', $2)`, [value, Boolean(local)]);
}

async function clearDbContext(client) {
  await client.query(`SELECT set_config('app.current_tenant_id', '', false), set_config('app.service_context', '', false)`).catch(() => {});
}

async function withDatabaseSession(pool, fn) {
  const client = await pool.connect();

  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function withDatabaseTransaction(pool, fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}


async function withTenantSession(pool, tenantId, fn) {
  const client = await pool.connect();
  try {
    await setTenantContext(client, tenantId, { local: false });
    return await fn(client);
  } finally {
    await clearDbContext(client);
    client.release();
  }
}

async function withServiceSession(pool, serviceContext, fn) {
  const client = await pool.connect();
  try {
    await setServiceContext(client, serviceContext, { local: false });
    return await fn(client);
  } finally {
    await clearDbContext(client);
    client.release();
  }
}

async function withTenantTransaction(pool, tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, tenantId, { local: true });
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function withServiceTransaction(pool, serviceContext, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setServiceContext(client, serviceContext, { local: true });
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  SERVICE_CONTEXTS: [...SERVICE_CONTEXTS],
  assertTenantId,
  assertServiceContext,
  setTenantContext,
  setServiceContext,
  clearDbContext,
  withDatabaseSession,
  withDatabaseTransaction,
  withTenantSession,
  withServiceSession,
  withTenantTransaction,
  withServiceTransaction
};
