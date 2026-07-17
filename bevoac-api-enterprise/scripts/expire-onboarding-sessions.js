if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}
const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

async function main() {
  const db = getDatabaseConfig();
  const client = new Client({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, ssl: db.ssl });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE azure_onboarding_sessions
       SET status = 'EXPIRED', updated_at = NOW()
       WHERE status = 'STARTED' AND expires_at < NOW()`
    );
    console.log(JSON.stringify({ expiredSessions: result.rowCount || 0 }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
