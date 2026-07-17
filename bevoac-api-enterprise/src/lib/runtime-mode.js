'use strict';

const RUNTIME_MODES = new Set([
  'combined',
  'public_api',
  'admin_api',
  'outbox',
  'retention'
]);

function resolveRuntimeMode(value = 'combined') {
  const normalized = String(value || 'combined')
    .trim()
    .toLowerCase();

  if (!RUNTIME_MODES.has(normalized)) {
    throw new Error(
      `Unsupported APP_RUNTIME_MODE: ${value}. ` +
      `Expected one of: ${[...RUNTIME_MODES].join(', ')}.`
    );
  }

  return normalized;
}

function runtimeSupportsPublicApi(runtimeMode) {
  return runtimeMode === 'combined' || runtimeMode === 'public_api';
}

function runtimeSupportsAdminApi(runtimeMode) {
  return runtimeMode === 'combined' || runtimeMode === 'admin_api';
}

function runtimeRequiresServiceBus(runtimeMode, outboxConfig = {}) {
  if (runtimeMode === 'outbox') return true;

  if (!runtimeSupportsPublicApi(runtimeMode)) return false;

  return (
    outboxConfig.publisherEnabled !== false ||
    outboxConfig.immediatePublishAfterRequest !== false
  );
}

function isHttpRuntime(runtimeMode) {
  return (
    runtimeMode === 'combined' ||
    runtimeMode === 'public_api' ||
    runtimeMode === 'admin_api'
  );
}

module.exports = {
  RUNTIME_MODES: [...RUNTIME_MODES],
  resolveRuntimeMode,
  runtimeSupportsPublicApi,
  runtimeSupportsAdminApi,
  runtimeRequiresServiceBus,
  isHttpRuntime
};
