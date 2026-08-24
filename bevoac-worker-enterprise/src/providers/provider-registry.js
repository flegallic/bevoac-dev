'use strict';

const PROVIDER_CONTRACT_VERSION = '2026-07-29-provider-registry-v1';

const PROVIDER_STATUS = Object.freeze({
  azure: Object.freeze({
    key: 'azure',
    runtimeEnabled: true,
    scannerImplemented: true,
    credentialModel: 'microsoft-entra-cross-tenant',
    targetContract: 'azure',
    productionStatus: 'production-controlled'
  }),
  aws: Object.freeze({
    key: 'aws',
    runtimeEnabled: false,
    scannerImplemented: false,
    credentialModel: 'sts-assume-role-external-id',
    targetContract: 'aws',
    productionStatus: 'foundation-only',
    reason:
      'AWS remains fail-closed until the AssumeRole onboarding flow, ' +
      'account and region ownership checks, scanners, normalized findings, ' +
      'resource preflight, billing and integration tests are complete.'
  }),
  gcp: Object.freeze({
    key: 'gcp',
    runtimeEnabled: false,
    scannerImplemented: false,
    credentialModel: 'workload-identity-federation',
    targetContract: 'gcp',
    productionStatus: 'roadmap',
    reason:
      'GCP is declared for architectural compatibility only and has no ' +
      'runtime scanner or onboarding implementation in V6.2.0.'
  })
});

function normalizeProvider(provider) {
  return String(provider || '').trim().toLowerCase();
}

function getProviderStatus(provider) {
  return PROVIDER_STATUS[normalizeProvider(provider)] || null;
}

function assertProviderRuntimeEnabled(provider) {
  const normalized = normalizeProvider(provider);
  const status = getProviderStatus(normalized);

  if (!status) {
    throw new Error(`Unsupported cloud provider: ${provider}`);
  }

  if (!status.runtimeEnabled || !status.scannerImplemented) {
    throw new Error(
      `Cloud provider ${normalized} is not runtime-enabled in Bevoac ` +
      `V6.2.0: ${status.reason || 'scanner not implemented'}`
    );
  }

  return status;
}

module.exports = {
  PROVIDER_CONTRACT_VERSION,
  PROVIDER_STATUS,
  normalizeProvider,
  getProviderStatus,
  assertProviderRuntimeEnabled
};
