'use strict';

const ADAPTER_VERSION = '1.0.0';
const REQUIRED_METHODS = Object.freeze([
  'validateCredentialReference',
  'discoverScope',
  'preflight',
  'runModules',
  'normalizeFindings'
]);

function assertProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('Provider adapter must be an object.');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`Provider adapter is missing ${method}().`);
    }
  }
  if (adapter.version !== ADAPTER_VERSION) {
    throw new TypeError(`Provider adapter version must be ${ADAPTER_VERSION}.`);
  }
  return adapter;
}

function normalizedFinding(input) {
  const provider = String(input?.provider || '').toLowerCase();
  if (!['azure', 'aws', 'gcp'].includes(provider)) {
    throw new TypeError('Unsupported provider finding.');
  }
  if (!input.controlId || !input.status || !input.severity) {
    throw new TypeError('Finding requires controlId, status and severity.');
  }
  return Object.freeze({
    provider,
    controlId: String(input.controlId),
    status: String(input.status),
    severity: String(input.severity),
    resource: input.resource || null,
    evidence: input.evidence || {},
    remediation: input.remediation || null
  });
}

module.exports = {
  ADAPTER_VERSION,
  REQUIRED_METHODS,
  assertProviderAdapter,
  normalizedFinding
};
