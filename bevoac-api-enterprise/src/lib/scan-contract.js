'use strict';

const { ValidationError } = require('./errors');
const { normalizeUuid, normalizeHttpsTargetUrl } = require('./target-authorization');

const WEB_MODULES = ['web'];
const ENTRA_MODULES = ['entra', 'identity_admin_posture'];
const INFRA_MODULES = [
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
];
const PROFILE_MODULES = {
  web: WEB_MODULES,
  entra: ENTRA_MODULES,
  infra: INFRA_MODULES,
  full: [...WEB_MODULES, ...ENTRA_MODULES, ...INFRA_MODULES]
};
const ALLOWED_MODULES = new Set(PROFILE_MODULES.full);
const INFRA_MODULE_SET = new Set(INFRA_MODULES);
const ENTRA_MODULE_SET = new Set(ENTRA_MODULES);

function normalizeModules(scanProfile, requestedModules) {
  const allowedForProfile = new Set(PROFILE_MODULES[scanProfile] || []);
  if (Array.isArray(requestedModules) && requestedModules.length > 0) {
    const normalized = [];
    for (const item of requestedModules) {
      const moduleName = String(item || '').trim().toLowerCase();
      if (!ALLOWED_MODULES.has(moduleName)) throw new ValidationError(`Unsupported scan module: ${item}`);
      if (!allowedForProfile.has(moduleName)) throw new ValidationError(`Module ${moduleName} is not allowed for scanProfile=${scanProfile}.`);
      if (!normalized.includes(moduleName)) normalized.push(moduleName);
    }
    if (normalized.length === 0) throw new ValidationError('No valid modules were provided.');
    return normalized;
  }
  return PROFILE_MODULES[scanProfile] || [];
}

function normalizeOptionalSubscriptionList(azure) {
  const raw = Array.isArray(azure?.subscriptionIds) ? azure.subscriptionIds : Array.isArray(azure?.subscriptions) ? azure.subscriptions : [];
  const normalized = raw.map((item) => normalizeUuid(item, 'azure.subscriptionIds[]'));
  if (new Set(normalized).size !== normalized.length) throw new ValidationError('azure.subscriptionIds cannot contain duplicates.');
  return normalized;
}

function validateAzurePayload(scanProfile, azure, normalizedModules = PROFILE_MODULES[scanProfile] || []) {
  const input = azure && typeof azure === 'object' ? azure : {};
  if (azure !== undefined && azure !== null && typeof azure !== 'object') throw new ValidationError('azure must be a JSON object when provided.');
  const normalized = { targetUrl: null, microsoftTenantId: null, subscriptions: [] };
  const modules = Array.isArray(normalizedModules) ? normalizedModules : [];
  const needsWebTarget = modules.includes('web');
  const needsAzureTenantScope = modules.some((item) => ENTRA_MODULE_SET.has(item) || INFRA_MODULE_SET.has(item));
  const needsAzureSubscriptions = modules.some((item) => INFRA_MODULE_SET.has(item));
  if (needsWebTarget) {
    if (!input.targetUrl) throw new ValidationError('azure.targetUrl is required when the web module is requested.');
    normalized.targetUrl = normalizeHttpsTargetUrl(input.targetUrl).url;
  }
  if (input.microsoftTenantId) normalized.microsoftTenantId = normalizeUuid(input.microsoftTenantId, 'azure.microsoftTenantId');
  if (needsAzureTenantScope && input.microsoftTenantId) normalized.microsoftTenantId = normalizeUuid(input.microsoftTenantId, 'azure.microsoftTenantId');
  if (needsAzureSubscriptions) normalized.subscriptions = normalizeOptionalSubscriptionList(input);
  return normalized;
}

function resolveBillingUnits(scanProfile, azure) {
  if (scanProfile === 'infra' || scanProfile === 'full') return Math.max(1, Array.isArray(azure?.subscriptions) ? azure.subscriptions.length : 1);
  return 1;
}

module.exports = {
  ALLOWED_MODULES: [...ALLOWED_MODULES],
  PROFILE_MODULES,
  WEB_MODULES,
  ENTRA_MODULES,
  INFRA_MODULES,
  normalizeModules,
  validateAzurePayload,
  resolveBillingUnits
};
