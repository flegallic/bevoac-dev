'use strict';

const { RetryableWorkerError, isRetryableError } = require('./worker-errors');

class ModuleTimeoutError extends RetryableWorkerError {
  constructor(label, timeoutMs) {
    super(`${label} timeout after ${timeoutMs} ms`, {
      code: 'MODULE_TIMEOUT',
      publicMessage: 'A scan module exceeded its execution deadline and will be retried.'
    });
    this.timeoutMs = timeoutMs;
    this.label = label;
  }
}

function abortReason(signal, label) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new RetryableWorkerError(`${label} aborted.`, {
    code: 'MODULE_ABORTED',
    publicMessage: 'A scan module was interrupted and will be retried.'
  });
  error.name = 'AbortError';
  return error;
}

async function withTimeout(label, timeoutMs, fn, { parentSignal = null } = {}) {
  if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) <= 0) {
    throw new Error(`Invalid timeout for ${label}.`);
  }

  const controller = new AbortController();
  const timeoutError = new ModuleTimeoutError(label, Number(timeoutMs));
  let timeoutHandle;
  let rejectAbort;

  const interruptionPromise = new Promise((_, reject) => {
    rejectAbort = reject;
  });

  const interrupt = (error) => {
    if (!controller.signal.aborted) controller.abort(error);
    rejectAbort(error);
  };

  const onParentAbort = () => interrupt(abortReason(parentSignal, label));

  if (parentSignal) {
    if (parentSignal.aborted) onParentAbort();
    else parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  timeoutHandle = setTimeout(() => interrupt(timeoutError), Number(timeoutMs));

  const operationPromise = Promise.resolve().then(() => fn({ signal: controller.signal }));
  // A non-cancellable SDK call can settle after the deadline. Attach a handler so
  // a late rejection never becomes an unhandled promise rejection.
  operationPromise.catch(() => {});

  try {
    return await Promise.race([operationPromise, interruptionPromise]);
  } finally {
    clearTimeout(timeoutHandle);
    if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
  }
}

async function settleModule(label, timeoutMs, fn, options = {}) {
  try {
    return await withTimeout(label, timeoutMs, fn, options);
  } catch (error) {
    if (isRetryableError(error) || error?.name === 'AbortError') throw error;
    return { error: 'Module execution failed.', errorCode: String(error?.code || 'MODULE_FAILED'), timeoutMs };
  }
}

module.exports = { ModuleTimeoutError, withTimeout, settleModule };
