'use strict';

const {
  ForbiddenError,
  UnauthorizedError
} = require('./errors');

let joseCache = null;
let jwksCache = null;

async function getJose() {
  if (!joseCache) joseCache = await import('jose');
  return joseCache;
}

function claimHasRequiredRole(payload, requiredRoles) {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  const roles = Array.isArray(payload?.roles) ? payload.roles : [];
  const effective = new Set(roles.map((role) => String(role)));
  return requiredRoles.some((role) => effective.has(role));
}

function deriveJwksUri(issuer) {
  const clean = String(issuer || '').replace(/\/$/, '');
  if (clean.endsWith('/v2.0')) {
    return `${clean.slice(0, -5)}/discovery/v2.0/keys`;
  }
  return `${clean}/discovery/v2.0/keys`;
}

async function verifyOidcAdminToken(config, token) {
  if (!token) {
    throw new UnauthorizedError('Missing admin Bearer token.');
  }

  const { createRemoteJWKSet, jwtVerify } = await getJose();
  const jwksUri = config.oidc.jwksUri || deriveJwksUri(config.oidc.issuer);

  if (!jwksCache || jwksCache.uri !== jwksUri) {
    jwksCache = {
      uri: jwksUri,
      value: createRemoteJWKSet(new URL(jwksUri))
    };
  }

  const verified = await jwtVerify(token, jwksCache.value, {
    issuer: config.oidc.issuer,
    audience: config.oidc.audience,
    clockTolerance: config.oidc.clockToleranceSeconds || 60
  });

  if (
    config.oidc.tenantId &&
    String(verified.payload.tid || '').toLowerCase() !==
      String(config.oidc.tenantId).toLowerCase()
  ) {
    throw new ForbiddenError(
      'Admin token was issued by an unauthorized tenant.'
    );
  }

  if (!claimHasRequiredRole(verified.payload, config.oidc.requiredRoles)) {
    throw new ForbiddenError(
      'Admin token does not contain a required application role.'
    );
  }

  return verified.payload;
}

function resetAdminOidcCachesForTests() {
  joseCache = null;
  jwksCache = null;
}

module.exports = {
  claimHasRequiredRole,
  deriveJwksUri,
  verifyOidcAdminToken,
  resetAdminOidcCachesForTests
};
