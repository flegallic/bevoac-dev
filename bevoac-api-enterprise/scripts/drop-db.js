#!/usr/bin/env node
'use strict';

/*
 * Bevoac - destructive application database reset
 *
 * Purpose:
 *   Drop the Bevoac application tables from the configured PostgreSQL database,
 *   then allow a clean rebuild with: node scripts/init-db.js
 *
 * This does NOT delete the Azure PostgreSQL Flexible Server and does NOT drop the
 * physical PostgreSQL database itself. It drops the Bevoac application schema
 * objects listed below.
 *
 * Required safeguards:
 *   ALLOW_DESTRUCTIVE_DB_DROP=yes
 *   DROP_DB_CONFIRM_TARGET=<PG_HOST>/<PG_DATABASE>
 *
 * Optional:
 *   DRY_RUN=true                 Print SQL only, do not execute.
 *   DROP_PGCRYPTO_EXTENSION=yes  Also drop pgcrypto extension. Usually not needed.
 */

const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {
  // dotenv is optional for environments where variables are injected by the platform.
}

const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

const APP_TABLES = [
  'scan_request_idempotency',
  'azure_onboarding_sessions',
  'tenant_azure_integrations',
  'tenant_azure_scopes',
  'tenant_web_targets',
  'billing_usage_ledger',
  'billing_monthly_snapshots',
  'scans',
  'api_keys',
  'tenants',
  'admin_audit_log'
];

function quoteIdentifier(identifier) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function buildDropSql() {
  const tables = APP_TABLES.map((table) => `public.${quoteIdentifier(table)}`).join(',\n        ');
  return `
    SET lock_timeout = '10s';
    SET statement_timeout = '120s';

    DROP TABLE IF EXISTS
        ${tables}
    CASCADE;
  `;
}

async function listExistingTables(client) {
  const result = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `
  );
  return result.rows.map((row) => row.table_name);
}

async function main() {
  const db = getDatabaseConfig();
  const target = `${db.host}/${db.database}`;

  if (process.argv.includes('--print-target')) {
    console.log(target);
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Blocked: destructive database reset is forbidden when NODE_ENV=production.');
  }

  if (process.env.ALLOW_DESTRUCTIVE_DB_DROP !== 'yes') {
    throw new Error('Set ALLOW_DESTRUCTIVE_DB_DROP=yes to confirm destructive staging/demo reset.');
  }

  if (process.env.DROP_DB_CONFIRM_TARGET !== target) {
    throw new Error(
      [
        'Target confirmation mismatch.',
        `Expected: DROP_DB_CONFIRM_TARGET=${target}`,
        'This guard prevents dropping the wrong Bevoac environment.'
      ].join('\n')
    );
  }

  const dropSql = buildDropSql();
  const shouldDropPgcrypto = process.env.DROP_PGCRYPTO_EXTENSION === 'yes';
  const dryRun = process.env.DRY_RUN === 'true';

  console.log('Bevoac destructive application DB reset');
  console.log(`- host: ${db.host}`);
  console.log(`- database: ${db.database}`);
  console.log(`- user: ${db.user}`);
  console.log(`- dryRun: ${dryRun}`);
  console.log(`- dropPgcryptoExtension: ${shouldDropPgcrypto}`);

  if (dryRun) {
    console.log('\nSQL that would be executed:');
    console.log(dropSql);
    if (shouldDropPgcrypto) {
      console.log('DROP EXTENSION IF EXISTS pgcrypto;');
    }
    return;
  }

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
    const before = await listExistingTables(client);
    console.log(`Tables before drop: ${before.length ? before.join(', ') : '(none)'}`);

    await client.query('BEGIN');
    await client.query(dropSql);

    if (shouldDropPgcrypto) {
      await client.query('DROP EXTENSION IF EXISTS pgcrypto;');
    }

    await client.query('COMMIT');

    const after = await listExistingTables(client);
    console.log(`Tables after drop: ${after.length ? after.join(', ') : '(none)'}`);
    console.log('Application schema dropped successfully.');
    console.log('Next step: node scripts/init-db.js');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // Ignore rollback errors; original error is more useful.
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});