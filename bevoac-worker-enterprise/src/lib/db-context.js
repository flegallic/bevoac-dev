'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function assertTenantId(tenantId) {
  const value = String(tenantId || '').trim().toLowerCase();
  if (!UUID_RE.test(value)) throw new Error('Invalid tenantId for database context.');
  return value;
}

async function setTenantContext(client, tenantId, { local = true } = {}) {
  const value = assertTenantId(tenantId);
  await client.query(`SELECT set_config('app.current_tenant_id', $1, $2)`, [value, Boolean(local)]);
}

async function clearDbContext(client) {
  await client.query(`SELECT set_config('app.current_tenant_id', '', false)`).catch(() => {});
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

module.exports = {
  assertTenantId,
  setTenantContext,
  clearDbContext,
  withTenantSession,
  withTenantTransaction,
};
