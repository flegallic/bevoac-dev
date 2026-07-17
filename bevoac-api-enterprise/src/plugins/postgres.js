const fp = require('fastify-plugin');
const { Pool } = require('pg');

module.exports = fp(async function postgresPlugin(fastify) {
  const config = fastify.config.postgres;
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: config.max,
    ssl: config.ssl,
    application_name: 'bevoac-api-enterprise',
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    fastify.log.info('PostgreSQL connectivity verified.');
  } finally {
    client.release();
  }

  fastify.decorate('pg', pool);
  fastify.addHook('onClose', async () => {
    await pool.end();
  });
});
