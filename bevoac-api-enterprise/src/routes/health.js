module.exports = async function healthRoutes(fastify) {
  fastify.get('/health', {
    schema: {
      summary: 'Health probe',
      tags: ['health']
    }
  }, async function handler() {
    await fastify.pg.query('SELECT 1');
    return {
      status: 'OK',
      service: 'bevoac-api-enterprise',
      dependencies: {
        postgres: 'reachable',
        serviceBus: 'not_checked'
      },
      timestamp: new Date().toISOString()
    };
  });
};
