#!/usr/bin/env node
'use strict';

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

const TABLES = [
  'scans',
  'scan_results',
  'scan_attempts',
  'scan_request_idempotency',
  'billing_usage_ledger',
  'outbox_events',
  'tenant_web_targets',
  'tenant_azure_scopes'
];

async function main() {
  const db = getDatabaseConfig();
  const client = new Client({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, ssl: db.ssl });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, COUNT(p.polname)::int AS policy_count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
       GROUP BY c.relname, c.relrowsecurity
       ORDER BY c.relname`,
      [TABLES]
    );
    const seen = new Map(result.rows.map((row) => [row.table_name, row]));
    let failures = 0;
    for (const table of TABLES) {
      const row = seen.get(table);
      if (!row) {
        console.log(`[SKIP] ${table}: table not found`);
        continue;
      }
      if (row.rls_enabled !== true || Number(row.policy_count || 0) < 1) {
        console.error(`[FAIL] ${table}: rls_enabled=${row.rls_enabled}, policy_count=${row.policy_count}`);
        failures += 1;
      } else {
        console.log(`[OK] ${table}: RLS enabled with ${row.policy_count} policy/policies`);
      }
    }
    const funcs = await client.query(`SELECT to_regprocedure('public.bevoac_current_tenant_id()') AS tenant_func, to_regprocedure('public.bevoac_is_service_context()') AS service_func`);
    if (!funcs.rows[0].tenant_func || !funcs.rows[0].service_func) {
      console.error('[FAIL] RLS helper functions are missing.');
      failures += 1;
    } else {
      console.log('[OK] RLS helper functions are present.');
    }
    if (failures > 0) process.exit(1);
    console.log('RLS tenant policy checks passed.');
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
