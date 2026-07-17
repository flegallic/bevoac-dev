'use strict';

const PROVIDER_STATUS = Object.freeze({
  azure: Object.freeze({ runtimeEnabled: true, scannerImplemented: true }),
  aws: Object.freeze({ runtimeEnabled: false, scannerImplemented: false, reason: 'AWS scanner foundation only. Do not enable before IAM, STS AssumeRole, Organizations discovery, Security Hub/Config adapters and integration tests are complete.' })
});

function getProviderStatus(provider) {
  return PROVIDER_STATUS[String(provider || '').toLowerCase()] || null;
}

function assertProviderRuntimeEnabled(provider) {
  const status = getProviderStatus(provider);
  if (!status) throw new Error(`Unsupported cloud provider: ${provider}`);
  if (!status.runtimeEnabled || !status.scannerImplemented) throw new Error(`Cloud provider ${provider} is not runtime-enabled: ${status.reason || 'scanner not implemented'}`);
  return status;
}

module.exports = { PROVIDER_STATUS, getProviderStatus, assertProviderRuntimeEnabled };
