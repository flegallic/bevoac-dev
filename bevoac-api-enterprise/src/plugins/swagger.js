const fp = require('fastify-plugin');
const swagger = require('@fastify/swagger');
const swaggerUi = require('@fastify/swagger-ui');

module.exports = fp(async function swaggerPlugin(fastify) {
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Bevoac Enterprise API',
        version: '4.0.0',
        description: 'Enterprise-ready B2B SaaS API for audit orchestration, Azure onboarding, tenant isolation and billing governance.'
      }
    }
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs'
  });
});
