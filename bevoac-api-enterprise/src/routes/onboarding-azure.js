'use strict';

const {
  AzureOnboardingService
} = require('../services/azure-onboarding-service');
const {
  ONBOARDING_RESULT_RETURN_URL,
  ONBOARDING_RESULT_STYLE,
  ONBOARDING_RESULT_SCRIPT
} = require('../lib/onboarding-result-assets');

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
<html lang="en" data-onboarding-state="unknown">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Azure onboarding result | Bevoac</title>
  <style>${ONBOARDING_RESULT_STYLE}</style>
</head>
<body>
  <div class="page-shell">
    <header class="brand" aria-label="Bevoac">
      <div class="brand-mark" aria-hidden="true">B</div>
      <div class="brand-copy">
        <span class="brand-name">BEVOAC</span>
        <span class="brand-context">Cloud security onboarding</span>
      </div>
    </header>

    <main class="result-card" aria-labelledby="result-title">
      <section class="result-header" aria-live="polite">
        <div class="status-row">
          <div class="status-icon" id="status-icon" aria-hidden="true">i</div>
          <div class="status-copy">
            <p class="eyebrow" id="status-label">Onboarding result</p>
            <h1 id="result-title">Azure onboarding result</h1>
            <p class="lead" id="result-message">Review the status of your Microsoft Azure connection.</p>
          </div>
        </div>
      </section>

      <div class="result-body">
        <section class="summary-card" id="subscription-panel" aria-labelledby="subscription-label" hidden>
          <div>
            <p class="summary-label">Microsoft Azure</p>
            <h2 class="summary-title" id="subscription-label">Azure subscriptions discovered</h2>
          </div>
          <div class="subscription-count" id="subscription-count" aria-label="Subscription count">0</div>
        </section>

        <section class="next-card" aria-labelledby="next-title">
          <h2 id="next-title">What happens next</h2>
          <p id="next-message">Return to the Bevoac workflow where you started onboarding.</p>
        </section>

        <div class="actions">
          <a class="primary-action" id="return-action" href="${ONBOARDING_RESULT_RETURN_URL}" rel="noreferrer" referrerpolicy="no-referrer" aria-describedby="return-help">Return to Bevoac</a>
          <p class="return-help" id="return-help">This link opens the Bevoac website. Continue setup in the application that started onboarding.</p>
        </div>

        <aside class="security-note" aria-label="Security information">
          <div class="security-badge" aria-hidden="true">✓</div>
          <p><strong>Secure by design.</strong> No client credential is requested or stored on this page.</p>
        </aside>
      </div>
    </main>

    <footer class="page-footer">Microsoft Azure onboarding · Bevoac</footer>
  </div>
  <script>${ONBOARDING_RESULT_SCRIPT}</script>
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
