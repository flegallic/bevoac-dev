if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');
const { normalizeUuid, normalizeHttpsTargetUrl } = require('../src/lib/target-authorization');

function splitList(value) {
  if (!value || value === '-') return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main() {
  const [bevoacTenantIdRaw, webTargetsRaw] = process.argv.slice(2);

  if (!bevoacTenantIdRaw || !webTargetsRaw) {
    throw new Error('Usage: node scripts/register-web-target.js <bevoacTenantId> <https://app.example.com,https://api.example.com>');
  }

  const bevoacTenantId = normalizeUuid(bevoacTenantIdRaw, 'bevoacTenantId');
  const hosts = splitList(webTargetsRaw).map((item) => normalizeHttpsTargetUrl(item).host);

  if (hosts.length === 0) {
    throw new Error('At least one HTTPS web target is required.');
  }

  const uniqueHosts = [...new Set(hosts)];
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
    await client.query('BEGIN');

    const tenant = await client.query(
      `SELECT id, company_name, is_active
       FROM tenants
       WHERE id = $1`,
      [bevoacTenantId]
    );

    if (tenant.rowCount !== 1) {
      throw new Error(`Unknown Bevoac tenant: ${bevoacTenantId}`);
    }

    if (!tenant.rows[0].is_active) {
      throw new Error(`Bevoac tenant is inactive: ${bevoacTenantId}`);
    }

    for (const host of uniqueHosts) {
      await client.query(
        `INSERT INTO tenant_web_targets (tenant_id, host, is_active, created_at, updated_at)
         VALUES ($1, $2, TRUE, NOW(), NOW())
         ON CONFLICT (tenant_id, host)
         DO UPDATE SET is_active = TRUE, updated_at = NOW()`,
        [bevoacTenantId, host]
      );
    }

    await client.query('COMMIT');

    console.log(JSON.stringify({
      bevoacTenantId,
      companyName: tenant.rows[0].company_name,
      webTargetsRegistered: uniqueHosts.length,
      hosts: uniqueHosts
    }, null, 2));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
