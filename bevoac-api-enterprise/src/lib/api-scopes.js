'use strict';

const DEFAULT_TENANT_SCOPES = Object.freeze([
  'scan:create',
  'scan:read',
  'scan:result:read',
  'scan:pdf:read',
  'billing:read',
  'onboarding:read',
  'onboarding:write'
]);

function normalizeScopes(value) {
  if (value == null) return [...DEFAULT_TENANT_SCOPES];
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { raw = raw.split(',').map((item) => item.trim()).filter(Boolean); }
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))];
}

function scopeMatches(grantedScope, requiredScope) {
  if (grantedScope === '*' || grantedScope === requiredScope) return true;
  if (grantedScope.endsWith(':*')) return requiredScope.startsWith(grantedScope.slice(0, -1));
  return false;
}

function hasScope(scopes, requiredScope) {
  const required = String(requiredScope || '').trim().toLowerCase();
  return normalizeScopes(scopes).some((scope) => scopeMatches(scope, required));
}

module.exports = { DEFAULT_TENANT_SCOPES, normalizeScopes, hasScope };
