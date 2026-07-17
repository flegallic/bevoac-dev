if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}
const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');
const { generateApiKey, hashApiKey } = require('../src/lib/security');
const { randomUUID } = require('crypto');

const ALLOWED_PLANS = ['free', 'standard', 'business', 'payg'];

async function main() {
  const companyName = process.argv[2];
  const planCode = String(process.argv[3] || 'standard').trim().toLowerCase();
  const label = process.argv[4] || 'primary';
  if (!companyName) {
    throw new Error('Usage: node scripts/create-tenant.js "CLIENT_NAME" <free|standard|business|payg> [keyLabel]');
  }
  if (!ALLOWED_PLANS.includes(planCode)) {
    throw new Error(`Invalid plan. Allowed values: ${ALLOWED_PLANS.join(', ')}`);
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

  const rawApiKey = generateApiKey();
  const tenantId = randomUUID();

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tenants (id, company_name, plan_code, is_active, created_at, updated_at) VALUES ($1, $2, $3, TRUE, NOW(), NOW())`,
      [tenantId, companyName, planCode]
    );
    await client.query(
      `INSERT INTO api_keys (tenant_id, key_hash, label, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '365 days')`,
      [tenantId, hashApiKey(rawApiKey), label]
    );
    await client.query('COMMIT');
    console.log('Tenant created successfully.');
    console.log(`Tenant ID: ${tenantId}`);
    console.log(`Company: ${companyName}`);
    console.log(`Plan: ${planCode}`);
    console.log(`API key (shown once): ${rawApiKey}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
