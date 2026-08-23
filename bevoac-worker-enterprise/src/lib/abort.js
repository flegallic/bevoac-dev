'use strict';

function abortError(signal, label = 'operation') {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error(`${label} aborted.`);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function throwIfAborted(signal, label = 'operation') {
  if (signal?.aborted) throw abortError(signal, label);
}

function azureAbortOptions(signal) {
  return signal ? { abortSignal: signal } : undefined;
}

module.exports = { abortError, throwIfAborted, azureAbortOptions };
