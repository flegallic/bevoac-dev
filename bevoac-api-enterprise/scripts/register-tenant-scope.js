if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}
const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');
const { normalizeUuid, normalizeHttpsTargetUrl } = require('../src/lib/target-authorization');

function splitList(value) {
  if (!value || value === '-') return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

async function main() {
  const [bevoacTenantIdRaw, microsoftTenantIdRaw, subscriptionsRaw = '-', webTargetsRaw = '-'] = process.argv.slice(2);
  if (!bevoacTenantIdRaw || !microsoftTenantIdRaw) {
    throw new Error('Usage: node scripts/register-tenant-scope.js <bevoacTenantId> <microsoftTenantId> [subscriptionId1,subscriptionId2|-] [https://app.example.com,https://api.example.com|-]');
  }
  const bevoacTenantId = normalizeUuid(bevoacTenantIdRaw, 'bevoacTenantId');
  const microsoftTenantId = normalizeUuid(microsoftTenantIdRaw, 'microsoftTenantId');
  const subscriptions = splitList(subscriptionsRaw).map((item) => normalizeUuid(item, 'subscriptionId'));
  const hosts = splitList(webTargetsRaw).map((item) => normalizeHttpsTargetUrl(item).host);

  const db = getDatabaseConfig();
  const client = new Client({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, ssl: db.ssl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tenant_azure_scopes (
         tenant_id, microsoft_tenant_id, subscription_id, display_name, is_active,
         source, status, verified_at, metadata, created_at, updated_at
       ) VALUES ($1, $2::uuid, NULL, 'Manual tenant scope', TRUE, 'manual_admin_verified', 'VERIFIED', NOW(), '{}'::jsonb, NOW(), NOW())
       ON CONFLICT (tenant_id, microsoft_tenant_id)
       WHERE subscription_id IS NULL
       DO UPDATE SET is_active = TRUE,
                     source = 'manual_admin_verified',
                     status = 'VERIFIED',
                     verified_at = NOW(),
                     updated_at = NOW()`,
      [bevoacTenantId, microsoftTenantId]
    );
    for (const subscriptionId of subscriptions) {
      await client.query(
        `INSERT INTO tenant_azure_scopes (
           tenant_id, microsoft_tenant_id, subscription_id, display_name, is_active,
           source, status, verified_at, metadata, created_at, updated_at
         ) VALUES ($1, $2::uuid, $3::uuid, 'Manual subscription scope', TRUE, 'manual_admin_verified', 'VERIFIED', NOW(), '{}'::jsonb, NOW(), NOW())
         ON CONFLICT (tenant_id, microsoft_tenant_id, subscription_id)
         WHERE subscription_id IS NOT NULL
         DO UPDATE SET is_active = TRUE,
                       source = 'manual_admin_verified',
                       status = 'VERIFIED',
                       verified_at = NOW(),
                       updated_at = NOW()`,
        [bevoacTenantId, microsoftTenantId, subscriptionId]
      );
    }
    for (const host of hosts) {
      await client.query(
        `INSERT INTO tenant_web_targets (tenant_id, host, is_active, created_at, updated_at)
         VALUES ($1, $2, TRUE, NOW(), NOW())
         ON CONFLICT (tenant_id, host)
         DO UPDATE SET is_active = TRUE, updated_at = NOW()`,
        [bevoacTenantId, host]
      );
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ bevoacTenantId, microsoftTenantId, subscriptionsRegistered: subscriptions.length, webTargetsRegistered: hosts.length }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
