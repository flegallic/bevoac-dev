#!/usr/bin/env node
'use strict';

if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}

const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

const REQUIRED_COLUMNS = [
  ['api_keys', 'scopes'],
  ['scans', 'billing_state'],
  ['scans', 'processing_attempt_id'],
  ['scans', 'result_size_bytes'],
  ['scan_request_idempotency', 'idempotency_key_source'],
  ['scan_results', 'result_summary'],
  ['outbox_events', 'status']
];

const REQUIRED_TABLES = [
  'scan_results',
  'scan_attempts',
  'outbox_events',
  'retention_audit_log'
];

const REQUIRED_INDEXES = [
  'idx_scans_quota_status',
  'idx_scan_results_summary_gin',
  'idx_scan_attempts_scan_started',
  'idx_idempotency_created',
  'idx_onboarding_sessions_expires'
];

const REQUIRED_LEDGER_EVENTS = [
  'scan_reserved',
  'scan_consumed',
  'scan_refunded'
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

  try {
    const missing = [];

    for (const table of REQUIRED_TABLES) {
      const result = await client.query(
        'SELECT to_regclass($1) AS object_name',
        [`public.${table}`]
      );

      if (!result.rows[0]?.object_name) {
        missing.push(`table:${table}`);
      }
    }

    for (const [table, column] of REQUIRED_COLUMNS) {
      const result = await client.query(
        `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
        `,
        [table, column]
      );

      if (result.rowCount !== 1) {
        missing.push(`column:${table}.${column}`);
      }
    }

    for (const index of REQUIRED_INDEXES) {
      const result = await client.query(
        `
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = $1
        `,
        [index]
      );

      if (result.rowCount !== 1) {
        missing.push(`index:${index}`);
      }
    }

    const ledgerConstraint = await client.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'valid_ledger_event_type'
      LIMIT 1
    `);

    const definition = ledgerConstraint.rows[0]?.definition || '';

    for (const eventType of REQUIRED_LEDGER_EVENTS) {
      if (!definition.includes(eventType)) {
        missing.push(`ledger_event:${eventType}`);
      }
    }

    if (missing.length > 0) {
      console.error('Enterprise hardening checks failed:', missing);
      process.exitCode = 1;
      return;
    }

    console.log(
      'Enterprise hardening baseline and operational schema checks passed.'
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
