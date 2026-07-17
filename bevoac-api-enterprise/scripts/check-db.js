if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}
const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

async function main() {
  const db = getDatabaseConfig();
  const client = new Client({
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
    ssl: db.ssl
  });
  await client.connect();
  try {
    const tables = ['tenants', 'api_keys', 'tenant_azure_integrations', 'tenant_azure_scopes', 'azure_onboarding_sessions', 'tenant_web_targets', 'scans', 'billing_usage_ledger', 'billing_monthly_snapshots', 'scan_request_idempotency', 'admin_audit_log'];
    for (const table of tables) {
      const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      console.log(`${table}: ${result.rows[0].count}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
