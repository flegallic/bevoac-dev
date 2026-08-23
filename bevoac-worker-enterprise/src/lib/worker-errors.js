'use strict';

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const TERMINAL_STATUS = new Set([400, 401, 403, 404, 405, 422]);
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETDOWN', 'ENETUNREACH',
  'EPIPE', 'ESOCKETTIMEDOUT', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT',
  'MODULE_TIMEOUT', 'RESOURCE_GRAPH_REPEATED_SKIP_TOKEN'
]);

class WorkerFailure extends Error {
  constructor(message, { code = 'WORKER_FAILURE', retryable = false, publicMessage = null, cause = null } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code;
    this.retryable = Boolean(retryable);
    this.publicMessage = publicMessage || (this.retryable
      ? 'A temporary cloud-provider error interrupted the scan. The request will be retried.'
      : 'The scan could not be completed.');
  }
}

class RetryableWorkerError extends WorkerFailure {
  constructor(message, options = {}) {
    super(message, { ...options, retryable: true, code: options.code || 'TRANSIENT_PROVIDER_FAILURE' });
  }
}

class TerminalWorkerError extends WorkerFailure {
  constructor(message, options = {}) {
    super(message, { ...options, retryable: false, code: options.code || 'TERMINAL_SCAN_FAILURE' });
  }
}

function statusCodeOf(error) {
  const candidates = [error?.statusCode, error?.status, error?.response?.status, error?.response?.statusCode];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return 0;
}

function safeCode(error) {
  const raw = String(error?.code || error?.name || 'WORKER_FAILURE').toUpperCase();
  return raw.replace(/[^A-Z0-9_.-]/g, '_').slice(0, 120) || 'WORKER_FAILURE';
}

function isRetryableError(error) {
  if (error instanceof WorkerFailure) return error.retryable;
  const status = statusCodeOf(error);
  if (RETRYABLE_STATUS.has(status)) return true;
  if (TERMINAL_STATUS.has(status)) return false;
  if (RETRYABLE_CODES.has(String(error?.code || '').toUpperCase())) return true;
  const message = String(error?.message || '').toLowerCase();
  return [
    'timeout', 'timed out', 'temporar', 'throttl', 'socket hang up', 'connection reset',
    'service unavailable', 'too many requests', 'network error', 'econnreset', 'etimedout'
  ].some((needle) => message.includes(needle));
}

function classifyWorkerError(error) {
  if (error instanceof WorkerFailure) return error;
  const retryable = isRetryableError(error);
  const status = statusCodeOf(error);
  const code = retryable
    ? (status === 429 ? 'UPSTREAM_THROTTLED' : status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'TRANSIENT_PROVIDER_FAILURE')
    : (status === 401 || status === 403 ? 'PROVIDER_PERMISSION_DENIED' : safeCode(error));
  const message = String(error?.message || error || code);
  const publicMessage = retryable
    ? 'A temporary cloud-provider error interrupted the scan. The request will be retried.'
    : status === 401 || status === 403
      ? 'The connected cloud scope does not grant the permissions required by this scan.'
      : 'The scan could not be completed.';
  return retryable
    ? new RetryableWorkerError(message, { code, publicMessage, cause: error })
    : new TerminalWorkerError(message, { code, publicMessage, cause: error });
}

function redactString(value) {
  return String(value || '')
    .replace(/(authorization|bearer|token|secret|password|client_secret|sig)=?[^\s&;,]*/gi, '$1=[REDACTED]')
    .replace(/https?:\/\/[^\s"']+/gi, '[REDACTED_URL]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '[REDACTED_UUID]')
    .slice(0, 1000);
}

function safeErrorProjection(error) {
  const classified = classifyWorkerError(error);
  return {
    code: classified.code,
    retryable: classified.retryable,
    statusCode: statusCodeOf(error) || null,
    message: redactString(classified.message)
  };
}

function publicFailurePayload(error, correlationId) {
  const classified = classifyWorkerError(error);
  return {
    code: classified.code,
    message: classified.publicMessage,
    correlationId: correlationId || null,
    retryable: classified.retryable
  };
}

module.exports = {
  WorkerFailure,
  RetryableWorkerError,
  TerminalWorkerError,
  classifyWorkerError,
  isRetryableError,
  safeErrorProjection,
  publicFailurePayload,
  redactString,
  statusCodeOf,
};
