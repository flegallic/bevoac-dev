function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function getStatusCode(error) { return Number(error?.statusCode || error?.code || error?.response?.status || error?.status || 0); }
function isRetriableAzureError(error) {
  const status = getStatusCode(error);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('timeout') || message.includes('throttl') || message.includes('temporar') || message.includes('socket hang up') || message.includes('econnreset') || message.includes('etimedout');
}
function retryAfterMs(error) {
  const header = error?.response?.headers?.get?.('retry-after') || error?.response?.headers?.['retry-after'];
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}
async function withRetry(fn, { label = 'operation', retries = 3, baseDelayMs = 500, maxDelayMs = 8000, shouldRetry = isRetriableAzureError, logger = null } = {}) {
  let attempt = 0;
  let lastError;
  while (attempt <= retries) {
    try { return await fn({ attempt }); } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const retryAfter = retryAfterMs(error);
      const jitter = Math.floor(Math.random() * 250);
      const delay = retryAfter || Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt)) + jitter;
      logger?.warn?.({ err: error, label, attempt: attempt + 1, delayMs: delay }, 'Retrying transient Azure/Graph operation.');
      await sleep(delay);
      attempt += 1;
    }
  }
  throw lastError;
}
module.exports = { withRetry, isRetriableAzureError };
