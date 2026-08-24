'use strict';

const fp = require('fastify-plugin');
const { ForbiddenError } = require('../lib/errors');
const { secureCompare } = require('../lib/security');
const {
  claimHasRequiredRole,
  verifyOidcAdminToken
} = require('../lib/admin-oidc');

function extractBearerToken(request) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !String(authHeader).startsWith('Bearer ')) {
    return null;
  }
  return String(authHeader).slice(7).trim();
}

module.exports = fp(async function authAdminPlugin(fastify) {
  fastify.decorate(
    'authenticateAdmin',
    async function authenticateAdmin(request) {
      const config = fastify.config.adminAuth;

      if (config.mode === 'shared_secret') {
        const providedSecret = request.headers['x-admin-secret'];
        if (!secureCompare(providedSecret, config.sharedSecret)) {
          throw new ForbiddenError('Admin access denied.');
        }
        request.adminActor = {
          subject: 'shared-secret-admin',
          authMode: 'shared_secret'
        };
        return;
      }

      const token = extractBearerToken(request);
      const payload = await verifyOidcAdminToken(config, token);
      request.adminActor = {
        subject:
          payload.sub ||
          payload.oid ||
          payload.preferred_username ||
          'unknown-admin',
        tenantId: payload.tid || null,
        username: payload.preferred_username || payload.upn || null,
        roles: Array.isArray(payload.roles) ? payload.roles : [],
        authMode: 'oidc'
      };
    }
  );
});

// Compatibility exports for existing tests/integrations. The implementation
// lives in a dependency-free library so authorization policy can be tested
// without loading Fastify.
module.exports.claimHasRequiredRole = claimHasRequiredRole;
module.exports.verifyOidcAdminToken = verifyOidcAdminToken;
module.exports.extractBearerToken = extractBearerToken;
