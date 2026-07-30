'use strict';

const { ValidationError } = require('./errors');

const PROVIDERS = Object.freeze({
  azure: Object.freeze({
    runtimeEnabled: true,
    status: 'production_controlled',
    credentialModel: 'microsoft-entra-cross-tenant',
    targetContract: 'azure',
    scanProfiles: ['web', 'entra', 'infra', 'full'],
    modules: [
      'web',
      'entra',
      'identity_admin_posture',
      'storage',
      'vms',
      'nsg',
      'keyvault',
      'logs',
      'db',
      'governance',
      'appservices',
      'finops',
      'entra_b2b',
      'tags',
      'exposure_map',
      'diagnostic_coverage',
      'encryption_coverage',
      'azure_rbac_exposure',
      'private_link_coverage',
      'policy_compliance'
    ]
  }),
  aws: Object.freeze({
    runtimeEnabled: false,
    status: 'foundation_only_not_runtime_enabled',
    credentialModel: 'sts-assume-role-external-id',
    targetContract: 'aws',
    scanProfiles: ['infra', 'full'],
    modules: [
      'aws_iam',
      'aws_s3',
      'aws_ec2',
      'aws_security_groups',
      'aws_kms',
      'aws_cloudtrail',
      'aws_config',
      'aws_costs',
      'aws_rds'
    ]
  }),
  gcp: Object.freeze({
    runtimeEnabled: false,
    status: 'roadmap_not_runtime_enabled',
    credentialModel: 'workload-identity-federation',
    targetContract: 'gcp',
    scanProfiles: ['infra', 'full'],
    modules: []
  })
});

function getProvider(providerName) {
  const key = String(providerName || '').trim().toLowerCase();
  return PROVIDERS[key] ? { key, ...PROVIDERS[key] } : null;
}

function assertRuntimeProvider(providerName) {
  const provider = getProvider(providerName);

  if (!provider) {
    throw new ValidationError(
      `Unsupported cloudProvider: ${providerName}`
    );
  }

  if (!provider.runtimeEnabled) {
    throw new ValidationError(
      `cloudProvider=${provider.key} is declared but not ` +
      `runtime-enabled in Bevoac V6.1.3. Enable it only after the ` +
      `provider credential model, onboarding flow, scanners, normalized ` +
      `findings, worker adapter, billing and integration tests are complete.`
    );
  }

  return provider;
}

module.exports = {
  PROVIDERS,
  getProvider,
  assertRuntimeProvider
};
