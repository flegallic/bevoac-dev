if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}
const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('reset-db is blocked in production.');
  }
  if (process.env.ALLOW_DESTRUCTIVE_DB_RESET !== 'yes') {
    throw new Error('Set ALLOW_DESTRUCTIVE_DB_RESET=yes to confirm staging-only destructive reset.');
  }

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
    await client.query('TRUNCATE TABLE scan_request_idempotency, billing_usage_ledger, billing_monthly_snapshots, scans, tenant_azure_scopes, tenant_web_targets, api_keys, tenants, admin_audit_log CASCADE');
    console.log('Staging database reset completed.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
