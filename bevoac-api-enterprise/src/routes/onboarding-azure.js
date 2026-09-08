'use strict';

const {
  AzureOnboardingService
} = require('../services/azure-onboarding-service');
const {
  ForbiddenError
} = require('../lib/errors');
const {
  ONBOARDING_RESULT_RETURN_URL,
  ONBOARDING_RESULT_STYLE,
  ONBOARDING_RESULT_SCRIPT,
  ONBOARDING_LANDING_STYLE,
  ONBOARDING_LANDING_SCRIPT
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

const EMPTY_BODY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  maxProperties: 0
});

const ONBOARDING_LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Microsoft Azure onboarding | Bevoac</title>
  <style>${ONBOARDING_LANDING_STYLE}</style>
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

    <main class="result-card" aria-labelledby="landing-title">
      <section class="result-header">
        <div class="status-row">
          <div class="status-icon" aria-hidden="true">→</div>
          <div class="status-copy">
            <p class="eyebrow">Microsoft Azure</p>
            <h1 id="landing-title">Connect Microsoft Azure to Bevoac</h1>
            <p class="lead">Authorize Bevoac to discover the Azure subscriptions that your organization explicitly grants access to. Administrator consent and RBAC validation are handled server-side.</p>
          </div>
        </div>
      </section>

      <div class="result-body">
        <section class="next-card" aria-labelledby="process-title">
          <h2 id="process-title">How onboarding works</h2>
          <div class="steps-grid">
            <div class="step-card">
              <div class="step-number" aria-hidden="true">1</div>
              <div><strong>Authenticate with Bevoac</strong><p>Use your Bevoac client API key to create a short-lived onboarding session.</p></div>
            </div>
            <div class="step-card">
              <div class="step-number" aria-hidden="true">2</div>
              <div><strong>Microsoft administrator consent</strong><p>A Microsoft Entra administrator approves the Bevoac application for the client tenant.</p></div>
            </div>
            <div class="step-card">
              <div class="step-number" aria-hidden="true">3</div>
              <div><strong>Read-only Azure verification</strong><p>Bevoac validates the subscriptions and RBAC scopes that are actually accessible.</p></div>
            </div>
            <div class="step-card">
              <div class="step-number" aria-hidden="true">4</div>
              <div><strong>Connection result</strong><p>The result page confirms success or clearly identifies any remaining Azure RBAC action.</p></div>
            </div>
          </div>
        </section>

        <form class="form-card" id="onboarding-form" autocomplete="off" novalidate>
          <h2>Start Azure onboarding</h2>
          <div class="field-group">
            <label class="field-label" for="api-key">Bevoac client API key</label>
            <input class="credential-input" id="api-key" name="apiKey" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="512" placeholder="bev_live_…" required>
            <p class="field-help">The key is used only for this request to create the onboarding session. This page does not store it in cookies, local storage, session storage or browser history, and it is never sent to Microsoft.</p>
          </div>
          <div class="form-actions">
            <button class="primary-action" id="start-button" type="submit">Start Microsoft admin consent</button>
            <p class="form-status" id="form-status" role="status" aria-live="polite"></p>
          </div>
        </form>

        <aside class="security-note" aria-label="Security information">
          <div class="security-badge" aria-hidden="true">✓</div>
          <p><strong>Secure by design.</strong> The browser-start endpoint is same-origin, API-key authenticated, scope checked and isolated from the APIM-protected business API surface.</p>
        </aside>
      </div>
    </main>

    <footer class="page-footer">Microsoft Azure onboarding · Bevoac</footer>
  </div>
  <script>${ONBOARDING_LANDING_SCRIPT}</script>
</body>
</html>`;

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
          <p id="next-message">Return to the Azure onboarding page to start or review the connection process.</p>
        </section>

        <div class="actions">
          <a class="primary-action" id="return-action" href="${ONBOARDING_RESULT_RETURN_URL}" rel="noreferrer" referrerpolicy="no-referrer" aria-describedby="return-help">Return to Azure onboarding</a>
          <p class="return-help" id="return-help">Return to the Bevoac Azure onboarding page to start or review the connection process.</p>
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

function configuredOnboardingOrigin(config) {
  const raw = String(config?.onboarding?.redirectUri || '').trim();
  if (!raw) return '';

  try {
    return new URL(raw).origin;
  } catch (_) {
    return '';
  }
}

function requireOnboardingBrowserOrigin(config, request) {
  const expectedOrigin = configuredOnboardingOrigin(config);
  const suppliedOrigin = String(request.headers.origin || '').trim();
  const fetchSite = String(request.headers['sec-fetch-site'] || '').trim().toLowerCase();

  if (!expectedOrigin || suppliedOrigin !== expectedOrigin) {
    throw new ForbiddenError(
      'Browser onboarding must originate from the Bevoac onboarding site.'
    );
  }

  if (fetchSite && fetchSite !== 'same-origin') {
    throw new ForbiddenError(
      'Cross-site browser onboarding requests are not allowed.'
    );
  }
}

module.exports = async function onboardingAzureRoutes(fastify) {
  const service = new AzureOnboardingService(
    fastify.pg,
    fastify.config,
    fastify.log
  );

  fastify.get('/onboarding/azure', {
    schema: {
      summary: 'Display the Bevoac Microsoft Azure onboarding page',
      tags: ['onboarding'],
      querystring: EMPTY_QUERY_SCHEMA
    }
  }, async function landingHandler(_request, reply) {
    return reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0')
      .send(ONBOARDING_LANDING_HTML);
  });

  fastify.post('/onboarding/azure/start', {
    schema: {
      summary: 'Start Microsoft admin consent onboarding',
      tags: ['onboarding'],
      security: [{ BevoacApiKey: [] }],
      querystring: EMPTY_QUERY_SCHEMA,
      body: EMPTY_BODY_SCHEMA
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

  fastify.post('/onboarding/azure/browser-start', {
    schema: {
      summary: 'Start Microsoft admin consent from the Bevoac onboarding browser page',
      tags: ['onboarding'],
      security: [{ BevoacApiKey: [] }],
      querystring: EMPTY_QUERY_SCHEMA,
      body: EMPTY_BODY_SCHEMA
    },
    preHandler: [
      async function requireBrowserOrigin(request) {
        requireOnboardingBrowserOrigin(fastify.config, request);
      },
      fastify.authenticateApiKey,
      fastify.requireApiScope('onboarding:write')
    ]
  }, async function browserStartHandler(request) {
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
module.exports.EMPTY_BODY_SCHEMA = EMPTY_BODY_SCHEMA;
module.exports.CALLBACK_QUERY_SCHEMA = CALLBACK_QUERY_SCHEMA;
module.exports.ONBOARDING_LANDING_HTML = ONBOARDING_LANDING_HTML;
module.exports.ONBOARDING_RESULT_HTML = ONBOARDING_RESULT_HTML;
module.exports.configuredOnboardingOrigin = configuredOnboardingOrigin;
module.exports.requireOnboardingBrowserOrigin = requireOnboardingBrowserOrigin;
