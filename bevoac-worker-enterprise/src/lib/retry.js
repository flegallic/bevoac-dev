'use strict';

const { isRetryableError, safeErrorProjection } = require('./worker-errors');

function sleep(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error('Retry sleep aborted.'));
    let settled = false;
    const cleanup = () => signal?.removeEventListener?.('abort', onAbort);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const handle = setTimeout(() => finish(resolve), ms);
    const onAbort = () => {
      clearTimeout(handle);
      finish(reject, signal.reason || new Error('Retry sleep aborted.'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}
function getStatusCode(error) { return Number(error?.statusCode || error?.response?.status || error?.status || 0); }
function isRetriableAzureError(error) { return isRetryableError(error); }
function retryAfterMs(error) {
  const header = error?.response?.headers?.get?.('retry-after') || error?.response?.headers?.['retry-after'];
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}
async function withRetry(fn, { label = 'operation', retries = 3, baseDelayMs = 500, maxDelayMs = 8000, shouldRetry = isRetriableAzureError, logger = null, signal = null } = {}) {
  let attempt = 0;
  let lastError;
  while (attempt <= retries) {
    if (signal?.aborted) throw signal.reason || new Error(`${label} aborted.`);
    try { return await fn({ attempt, signal }); } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const retryAfter = retryAfterMs(error);
      const jitter = Math.floor(Math.random() * 250);
      const delay = retryAfter || Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt)) + jitter;
      logger?.warn?.({ error: safeErrorProjection(error), label, attempt: attempt + 1, delayMs: delay }, 'Retrying transient Azure/Graph operation.');
      await sleep(delay, signal);
      attempt += 1;
    }
  }
  throw lastError;
}
module.exports = { withRetry, isRetriableAzureError, sleep };
