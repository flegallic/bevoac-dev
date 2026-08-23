'use strict';

const fp = require('fastify-plugin');
const swagger = require('@fastify/swagger');
const packageJson = require('../../package.json');

module.exports = fp(async function swaggerPlugin(fastify) {
  if (!fastify.config.swagger?.enabled) {
    fastify.log.info('OpenAPI document endpoint is disabled for this runtime.');
    return;
  }

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Bevoac API',
        version: packageJson.version,
        description:
          'B2B Azure-first security audit API for controlled production. ' +
          'Capabilities and limits are defined by the active release evidence.'
      },
      components: {
        securitySchemes: {
          BevoacApiKey: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'Bevoac API key'
          }
        }
      }
    }
  });

  fastify.get('/docs/openapi.json', {
    schema: {
      hide: true,
      querystring: {
        type: 'object',
        additionalProperties: false,
        maxProperties: 0
      }
    }
  }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return fastify.swagger();
  });
});
