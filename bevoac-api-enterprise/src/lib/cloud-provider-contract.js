'use strict';

const { ValidationError } = require('./errors');

const PROVIDERS = Object.freeze({
  azure: Object.freeze({
    runtimeEnabled: true,
    status: 'production_controlled',
    scanProfiles: ['web', 'entra', 'infra', 'full'],
    modules: ['web', 'entra', 'identity_admin_posture', 'storage', 'vms', 'nsg', 'keyvault', 'logs', 'db', 'governance', 'appservices', 'finops', 'entra_b2b', 'tags', 'exposure_map', 'diagnostic_coverage', 'encryption_coverage', 'azure_rbac_exposure', 'private_link_coverage', 'policy_compliance']
  }),
  aws: Object.freeze({
    runtimeEnabled: false,
    status: 'foundation_only_not_runtime_enabled',
    scanProfiles: ['infra', 'full'],
    modules: ['aws_iam', 'aws_s3', 'aws_ec2', 'aws_security_groups', 'aws_kms', 'aws_cloudtrail', 'aws_config', 'aws_costs', 'aws_rds']
  })
});

function getProvider(providerName) {
  const key = String(providerName || '').trim().toLowerCase();
  return PROVIDERS[key] ? { key, ...PROVIDERS[key] } : null;
}

function assertRuntimeProvider(providerName) {
  const provider = getProvider(providerName);
  if (!provider) throw new ValidationError(`Unsupported cloudProvider: ${providerName}`);
  if (!provider.runtimeEnabled) {
    throw new ValidationError(`cloudProvider=${provider.key} is scaffolded but not runtime-enabled in Bevoac V6.1.2. Enable only after the provider scanner, credential model, worker contract and tests are complete.`);
  }
  return provider;
}

module.exports = { PROVIDERS, getProvider, assertRuntimeProvider };
