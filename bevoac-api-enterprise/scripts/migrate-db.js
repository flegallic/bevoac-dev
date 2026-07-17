if (process.env.NODE_ENV !== 'production') { try { require('dotenv').config(); } catch (_) {} }
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

async function ensureMigrationTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(120) PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT NOW())`);
}
function listMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  return fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort().map((file) => ({
    file,
    version: file.replace(/\.sql$/, ''),
    sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8')
  }));
}
async function main() {
  const db = getDatabaseConfig();
  const client = new Client({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, ssl: db.ssl });
  await client.connect();
  try {
    await ensureMigrationTable(client);
    const applied = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(applied.rows.map((row) => row.version));
    for (const migration of listMigrations()) {
      if (appliedSet.has(migration.version)) { console.log(`[SKIP] ${migration.file}`); continue; }
      console.log(`[APPLY] ${migration.file}`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [migration.version, migration.file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    console.log('Database migrations completed successfully.');
  } finally { await client.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
