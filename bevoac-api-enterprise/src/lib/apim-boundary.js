'use strict';

const EXEMPT_PATHS = new Set([
  '/v1/health',
  '/v1/health/live',
  '/v1/health/ready',
  '/v1/onboarding/azure/callback',
  '/v1/onboarding/azure/result'
]);

function normalizedPath(value) {
  return String(value || '').split('?')[0];
}

function isBoundaryExempt(value) {
  return EXEMPT_PATHS.has(normalizedPath(value));
}

module.exports = {
  EXEMPT_PATHS,
  normalizedPath,
  isBoundaryExempt
};
