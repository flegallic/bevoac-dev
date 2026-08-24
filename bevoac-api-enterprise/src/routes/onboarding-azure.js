'use strict';

const {
  AzureOnboardingService
} = require('../services/azure-onboarding-service');

const UUID_SCHEMA = Object.freeze({
  type: 'string',
  format: 'uuid'
});

const EMPTY_QUERY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  maxProperties: 0
});

const ONBOARDING_RESULT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bevoac Azure onboarding</title>
</head>
<body>
  <main>
    <h1>Azure onboarding request processed</h1>
    <p>Return to your approved Bevoac client workflow and query the onboarding status through the API.</p>
    <p>No client credential is requested or stored on this page.</p>
  </main>
</body>
</html>`;

const CALLBACK_QUERY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['state'],
  properties: {
    state: {
      type: 'string',
      minLength: 1,
      maxLength: 4096
    },
    tenant: UUID_SCHEMA,
    admin_consent: {
      type: 'string',
      enum: ['True', 'False', 'true', 'false']
    },
    error: {
      type: 'string',
      maxLength: 120
    },
    error_description: {
      type: 'string',
      maxLength: 1000
    },
    error_uri: {
      type: 'string',
      format: 'uri',
      maxLength: 2048
    },
    error_codes: {
      anyOf: [
        { type: 'string', maxLength: 1000 },
        { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 32 } }
      ]
    },
    timestamp: {
      type: 'string',
      maxLength: 64
    },
    trace_id: UUID_SCHEMA,
    correlation_id: UUID_SCHEMA,
    scope: {
      type: 'string',
      maxLength: 2048
    }
  }
});

module.exports = async function onboardingAzureRoutes(fastify) {
  const service = new AzureOnboardingService(
    fastify.pg,
    fastify.config,
    fastify.log
  );

  fastify.post('/onboarding/azure/start', {
    schema: {
      summary: 'Start Microsoft admin consent onboarding',
      tags: ['onboarding'],
      security: [{ BevoacApiKey: [] }],
      querystring: EMPTY_QUERY_SCHEMA,
      body: {
        type: 'object',
        additionalProperties: false,
        maxProperties: 0
      }
    },
    preHandler: [
      fastify.authenticateApiKey,
      fastify.requireApiScope('onboarding:write')
    ]
  }, async function startHandler(request) {
    return service.startOnboarding({
      tenantId: request.tenantId,
      apiKeyId: request.apiKeyId,
      request
    });
  });

  fastify.get('/onboarding/azure/status', {
    schema: {
      summary: 'Get Azure onboarding status',
      tags: ['onboarding'],
      security: [{ BevoacApiKey: [] }],
      querystring: EMPTY_QUERY_SCHEMA
    },
    preHandler: [
      fastify.authenticateApiKey,
      fastify.requireApiScope('onboarding:read')
    ]
  }, async function statusHandler(request) {
    return service.getStatus(request.tenantId);
  });

  fastify.post('/onboarding/azure/verify', {
    schema: {
      summary: 'Re-check Azure RBAC and refresh subscriptions',
      tags: ['onboarding'],
      security: [{ BevoacApiKey: [] }],
      querystring: EMPTY_QUERY_SCHEMA,
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['microsoftTenantId'],
        properties: {
          microsoftTenantId: UUID_SCHEMA
        }
      }
    },
    preHandler: [
      fastify.authenticateApiKey,
      fastify.requireApiScope('onboarding:write')
    ]
  }, async function verifyHandler(request) {
    return service.reverifyTenant({
      tenantId: request.tenantId,
      microsoftTenantId: request.body.microsoftTenantId
    });
  });

  fastify.get('/onboarding/azure/result', {
    schema: {
      summary: 'Display a credential-free Azure onboarding result page',
      tags: ['onboarding'],
      querystring: EMPTY_QUERY_SCHEMA
    }
  }, async function resultHandler(_request, reply) {
    return reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0')
      .send(ONBOARDING_RESULT_HTML);
  });

  fastify.get('/onboarding/azure/callback', {
    schema: {
      summary: 'Microsoft admin consent callback',
      tags: ['onboarding'],
      querystring: CALLBACK_QUERY_SCHEMA
    }
  }, async function callbackHandler(request, reply) {
    const redirectUrl = await service.handleCallback(request.query || {});
    return reply.code(302).redirect(redirectUrl);
  });
};

module.exports.UUID_SCHEMA = UUID_SCHEMA;
module.exports.EMPTY_QUERY_SCHEMA = EMPTY_QUERY_SCHEMA;
module.exports.CALLBACK_QUERY_SCHEMA = CALLBACK_QUERY_SCHEMA;

module.exports.ONBOARDING_RESULT_HTML = ONBOARDING_RESULT_HTML;
