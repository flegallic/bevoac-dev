#!/usr/bin/env node
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

const CHECKS = [
  {
    name: 'scan_results tenant matches scans tenant',
    sql: `SELECT COUNT(*)::int AS count
          FROM scan_results r
          LEFT JOIN scans s ON s.id = r.scan_id AND s.tenant_id = r.tenant_id
          WHERE s.id IS NULL`
  },
  {
    name: 'scan_attempts tenant matches scans tenant',
    sql: `SELECT COUNT(*)::int AS count
          FROM scan_attempts a
          LEFT JOIN scans s ON s.id = a.scan_id AND s.tenant_id = a.tenant_id
          WHERE s.id IS NULL`
  },
  {
    name: 'outbox scan events tenant matches scans tenant',
    sql: `SELECT COUNT(*)::int AS count
          FROM outbox_events o
          LEFT JOIN scans s ON s.id = o.aggregate_id AND s.tenant_id = o.tenant_id
          WHERE o.aggregate_type = 'scan' AND s.id IS NULL`
  },
  {
    name: 'billing ledger scan entries tenant matches scans tenant',
    sql: `SELECT COUNT(*)::int AS count
          FROM billing_usage_ledger b
          LEFT JOIN scans s ON s.id = b.scan_id AND s.tenant_id = b.tenant_id
          WHERE b.scan_id IS NOT NULL AND s.id IS NULL`
  },
  {
    name: 'idempotency entries tenant matches scans tenant',
    sql: `SELECT COUNT(*)::int AS count
          FROM scan_request_idempotency i
          LEFT JOIN scans s ON s.id = i.scan_id AND s.tenant_id = i.tenant_id
          WHERE s.id IS NULL`
  }
];

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
  let failures = 0;
  try {
    for (const check of CHECKS) {
      const result = await client.query(check.sql);
      const count = Number(result.rows[0]?.count || 0);
      if (count > 0) {
        failures += 1;
        console.error(`[FAIL] ${check.name}: ${count} violation(s)`);
      } else {
        console.log(`[OK] ${check.name}`);
      }
    }
  } finally {
    await client.end();
  }

  if (failures > 0) {
    console.error(`[ERROR] Tenant isolation integrity checks failed: ${failures}`);
    process.exit(1);
  }
  console.log('Tenant isolation integrity checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
