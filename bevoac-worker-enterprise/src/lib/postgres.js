const { Pool } = require('pg');

function buildPgPool(config) {
  return new Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
    ssl: config.postgres.ssl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    application_name: config.workerName
  });
}

module.exports = { buildPgPool };
