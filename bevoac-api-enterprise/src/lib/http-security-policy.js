'use strict';

const NO_STORE_PREFIXES = Object.freeze([
  '/v1/scans',
  '/v1/billing',
  '/v1/onboarding',
  '/v1/admin'
]);

function normalizedPath(value) {
  return String(value || '').split('?')[0];
}

function shouldDisableCaching(value) {
  const path = normalizedPath(value);
  return NO_STORE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function headersForRequest({ url, requestId, production = false }) {
  const headers = {
    'X-Correlation-ID': requestId,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
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
  normalizedPath,
  shouldDisableCaching,
  headersForRequest
};
