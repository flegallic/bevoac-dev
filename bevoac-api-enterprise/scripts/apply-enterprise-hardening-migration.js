#!/usr/bin/env node
'use strict';

if (process.env.NODE_ENV !== 'production') { try { require('dotenv').config(); } catch (_) {} }
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

async function main() {
  const db = getDatabaseConfig();
  const client = new Client({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, ssl: db.ssl });
  await client.connect();
  try {
    const file = path.join(__dirname, '..', 'migrations', '202607090001_enterprise_hardening_baseline.sql');
    const sql = fs.readFileSync(file, 'utf8');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(120) PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT NOW())`);
    await client.query(`INSERT INTO schema_migrations(version, name) VALUES ($1, $2) ON CONFLICT(version) DO NOTHING`, ['202607090001_enterprise_hardening_baseline', '202607090001_enterprise_hardening_baseline.sql']);
    await client.query('COMMIT');
    console.log('Enterprise hardening baseline migration applied successfully.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
