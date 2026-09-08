'use strict';

const {
  ONBOARDING_RESULT_CSP,
  ONBOARDING_LANDING_CSP
} = require('./onboarding-result-assets');

const NO_STORE_PREFIXES = Object.freeze([
  '/v1/scans',
  '/v1/billing',
  '/v1/onboarding',
  '/v1/admin'
]);

const ONBOARDING_LANDING_PATH = '/v1/onboarding/azure';
const ONBOARDING_RESULT_PATH = '/v1/onboarding/azure/result';
const DEFAULT_CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function normalizedPath(value) {
  return String(value || '').split('?')[0];
}

function shouldDisableCaching(value) {
  const path = normalizedPath(value);
  return NO_STORE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function contentSecurityPolicyForRequest(value) {
  const path = normalizedPath(value);

  if (path === ONBOARDING_LANDING_PATH) {
    return ONBOARDING_LANDING_CSP;
  }

  if (path === ONBOARDING_RESULT_PATH) {
    return ONBOARDING_RESULT_CSP;
  }

  return DEFAULT_CONTENT_SECURITY_POLICY;
}

function headersForRequest({ url, requestId, production = false }) {
  const headers = {
    'X-Correlation-ID': requestId,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Content-Security-Policy': contentSecurityPolicyForRequest(url)
  };

  if (production) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }

  if (shouldDisableCaching(url)) {
    headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, private, max-age=0';
    headers.Pragma = 'no-cache';
    headers.Expires = '0';
  }

  return headers;
}

module.exports = {
  NO_STORE_PREFIXES,
  ONBOARDING_LANDING_PATH,
  ONBOARDING_RESULT_PATH,
  DEFAULT_CONTENT_SECURITY_POLICY,
  normalizedPath,
  shouldDisableCaching,
  contentSecurityPolicyForRequest,
  headersForRequest
};
