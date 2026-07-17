const fp = require('fastify-plugin');
const { ForbiddenError, UnauthorizedError } = require('../lib/errors');
const { secureCompare } = require('../lib/security');

let joseCache = null;
let jwksCache = null;

async function getJose() {
  if (!joseCache) joseCache = await import('jose');
  return joseCache;
}

function extractBearerToken(request) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !String(authHeader).startsWith('Bearer ')) return null;
  return String(authHeader).slice(7).trim();
}

function claimHasRequiredRole(payload, requiredRoles) {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  const roles = Array.isArray(payload.roles) ? payload.roles : [];
  const scopes = typeof payload.scp === 'string' ? payload.scp.split(/\s+/).filter(Boolean) : [];
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  const effective = new Set([...roles, ...scopes, ...groups]);
  return requiredRoles.some((role) => effective.has(role));
}

function deriveJwksUri(issuer) {
  const clean = String(issuer || '').replace(/\/$/, '');
  if (clean.endsWith('/v2.0')) return `${clean.slice(0, -5)}/discovery/v2.0/keys`;
  return `${clean}/discovery/v2.0/keys`;
}

async function verifyOidcAdminToken(config, token) {
  if (!token) throw new UnauthorizedError('Missing admin Bearer token.');
  const { createRemoteJWKSet, jwtVerify } = await getJose();
  const jwksUri = config.oidc.jwksUri || deriveJwksUri(config.oidc.issuer);
  if (!jwksCache || jwksCache.uri !== jwksUri) {
    jwksCache = { uri: jwksUri, value: createRemoteJWKSet(new URL(jwksUri)) };
  }
  const verified = await jwtVerify(token, jwksCache.value, {
    issuer: config.oidc.issuer,
    audience: config.oidc.audience,
    clockTolerance: config.oidc.clockToleranceSeconds || 60
  });
  if (!claimHasRequiredRole(verified.payload, config.oidc.requiredRoles)) {
    throw new ForbiddenError('Admin token does not contain the required role/scope/group.');
  }
  return verified.payload;
}

module.exports = fp(async function authAdminPlugin(fastify) {
  fastify.decorate('authenticateAdmin', async function authenticateAdmin(request) {
    const config = fastify.config.adminAuth;
    if (config.mode === 'shared_secret') {
      const providedSecret = request.headers['x-admin-secret'];
      if (!secureCompare(providedSecret, config.sharedSecret)) throw new ForbiddenError('Admin access denied.');
      request.adminActor = { subject: 'shared-secret-admin', authMode: 'shared_secret' };
      return;
    }

    const token = extractBearerToken(request);
    const payload = await verifyOidcAdminToken(config, token);
    request.adminActor = {
      subject: payload.sub || payload.oid || payload.preferred_username || 'unknown-admin',
      tenantId: payload.tid || null,
      username: payload.preferred_username || payload.upn || null,
      roles: payload.roles || [],
      authMode: 'oidc'
    };
  });
});
