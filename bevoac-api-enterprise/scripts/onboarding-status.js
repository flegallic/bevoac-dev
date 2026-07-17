if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}
const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');
const { normalizeUuid } = require('../src/lib/target-authorization');

async function main() {
  const [bevoacTenantIdRaw] = process.argv.slice(2);
  if (!bevoacTenantIdRaw) throw new Error('Usage: node scripts/onboarding-status.js <bevoacTenantId>');
  const bevoacTenantId = normalizeUuid(bevoacTenantIdRaw, 'bevoacTenantId');
  const db = getDatabaseConfig();
  const client = new Client({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, ssl: db.ssl });
  await client.connect();
  try {
    const integrations = await client.query(
      `SELECT microsoft_tenant_id, consent_status, subscription_count, last_verified_at, last_error
       FROM tenant_azure_integrations WHERE tenant_id = $1 ORDER BY updated_at DESC`,
      [bevoacTenantId]
    );
    const scopes = await client.query(
      `SELECT microsoft_tenant_id, subscription_id, display_name, is_active, source, status, verified_at
       FROM tenant_azure_scopes WHERE tenant_id = $1 ORDER BY microsoft_tenant_id, subscription_id NULLS FIRST`,
      [bevoacTenantId]
    );
    console.log(JSON.stringify({ bevoacTenantId, integrations: integrations.rows, scopes: scopes.rows }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
