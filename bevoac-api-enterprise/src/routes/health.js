'use strict';

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  maxProperties: 0
});

function healthPayload({ status, dependencies = {}, requestId }) {
  return {
    status,
    service: 'bevoac-api-enterprise',
    version: require('../../package.json').version,
    dependencies,
    correlationId: requestId,
    timestamp: new Date().toISOString()
  };
}

module.exports = async function healthRoutes(fastify) {
  const liveHandler = async function liveHandler(request) {
    return healthPayload({
      status: 'OK',
      dependencies: {},
      requestId: request.id
    });
  };

  const readyHandler = async function readyHandler(request, reply) {
    const dependencies = {
      postgres: 'unknown',
      serviceBus: fastify.config.serviceBus ? 'configured' : 'not_required'
    };

    try {
      await fastify.pg.query('SELECT 1');
      dependencies.postgres = 'reachable';
      return healthPayload({
        status: 'READY',
        dependencies,
        requestId: request.id
      });
    } catch (error) {
      request.log.error(
        { err: error, correlationId: request.id },
        'Readiness probe failed.'
      );
      dependencies.postgres = 'unreachable';
      return reply.code(503).send(healthPayload({
        status: 'NOT_READY',
        dependencies,
        requestId: request.id
      }));
    }
  };

  fastify.get('/health/live', {
    schema: {
      summary: 'Process liveness probe',
      tags: ['health'],
      querystring: EMPTY_OBJECT_SCHEMA
    }
  }, liveHandler);

  fastify.get('/health/ready', {
    schema: {
      summary: 'Runtime readiness probe',
      tags: ['health'],
      querystring: EMPTY_OBJECT_SCHEMA
    }
  }, readyHandler);

  // Backward-compatible alias used by existing probes.
  fastify.get('/health', {
    schema: {
      summary: 'Backward-compatible readiness probe',
      tags: ['health'],
      querystring: EMPTY_OBJECT_SCHEMA
    }
  }, readyHandler);

  if (typeof fastify.authenticateAdmin === 'function') {
    fastify.get('/health/deep', {
      schema: {
        summary: 'Authenticated deep diagnostic probe',
        tags: ['health'],
        querystring: EMPTY_OBJECT_SCHEMA
      },
      preHandler: [fastify.authenticateAdmin]
    }, async function deepHealthHandler(request) {
      const result = await fastify.pg.query(
        `
        SELECT
          current_database() AS database_name,
          current_user AS database_user,
          NOW() AS database_time
        `
      );

      return healthPayload({
        status: 'READY',
        requestId: request.id,
        dependencies: {
          postgres: {
            status: 'reachable',
            database: result.rows[0].database_name,
            role: result.rows[0].database_user,
            time: result.rows[0].database_time
          },
          serviceBus: fastify.config.serviceBus
            ? {
                status: 'configured',
                authMode: fastify.config.serviceBus.authMode,
                queueName: fastify.config.serviceBus.queueName,
                sessionsEnabled:
                  fastify.config.serviceBus.sessionsEnabled
              }
            : { status: 'not_required' }
        }
      });
    });
  }
};

module.exports.healthPayload = healthPayload;

module.exports.EMPTY_OBJECT_SCHEMA = EMPTY_OBJECT_SCHEMA;
