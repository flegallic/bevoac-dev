'use strict';

const SAFE_ERROR_CODES = new Set([
  'APP_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_ERROR',
  'TENANT_ACTIVE_SCAN_LIMIT_REACHED',
  'MONTHLY_SCAN_QUOTA_EXCEEDED'
]);

function sanitizeErrorDetails(error, env = process.env.NODE_ENV) {
  if (!error || !error.details) return null;
  if (env !== 'production') return error.details;
  const code = String(error.code || 'APP_ERROR');
  if (!SAFE_ERROR_CODES.has(code)) return null;
  const details = error.details;
  if (typeof details !== 'object' || Array.isArray(details)) return null;
  const allowed = {};
  for (const key of ['retryAfterSeconds', 'quotaMonth', 'quotaLimit', 'billingUnitsRequested', 'activeScanLimit', 'activeScanCount', 'planCode', 'remediation']) {
    if (Object.prototype.hasOwnProperty.call(details, key)) allowed[key] = details[key];
  }
  return Object.keys(allowed).length > 0 ? allowed : null;
}

module.exports = { sanitizeErrorDetails };
