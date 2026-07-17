'use strict';

const fp = require('fastify-plugin');
const { hashApiKey } = require('../lib/security');
const { UnauthorizedError, ForbiddenError } = require('../lib/errors');
const { normalizeScopes, hasScope } = require('../lib/api-scopes');
const { lookupApiKeyPrincipal } = require('../services/api-key-auth-service');

module.exports = fp(async function authApiKeyPlugin(fastify) {
  fastify.decorateRequest('tenantId', null);
  fastify.decorateRequest('apiKeyId', null);
  fastify.decorateRequest('apiKeyScopes', null);

  fastify.decorate(
    'authenticateApiKey',
    async function authenticateApiKey(request) {
      const authHeader = request.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedError(
          'Missing or invalid Authorization header. Expected Bearer API key.'
        );
      }

      const keyHash = hashApiKey(authHeader.slice(7));
      const principal = await lookupApiKeyPrincipal(fastify.pg, keyHash);

      if (!principal) {
        throw new UnauthorizedError(
          'Invalid, inactive or expired API key.'
        );
      }

      request.apiKeyId = principal.apiKeyId;
      request.tenantId = principal.tenantId;
      request.apiKeyScopes = normalizeScopes(principal.scopes);
    }
  );

  fastify.decorate(
    'requireApiScope',
    function requireApiScope(scope) {
      return async function requireApiScopeHandler(request) {
        if (!hasScope(request.apiKeyScopes, scope)) {
          throw new ForbiddenError(
            'API key scope is not allowed for this operation.',
            { requiredScope: scope }
          );
        }
      };
    }
  );
});
