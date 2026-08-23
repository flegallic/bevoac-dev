'use strict';

const { ValidationError } = require('./errors');
const { normalizeUuid, normalizeHttpsTargetUrl } = require('./target-authorization');
const {
  PROFILE_MODULES,
  MODULE_BY_NAME,
  modulesWithScope,
} = require('./module-catalog');

const WEB_MODULES = Object.freeze(modulesWithScope('web'));
const ENTRA_MODULES = Object.freeze(modulesWithScope('tenant'));
const INFRA_MODULES = Object.freeze(modulesWithScope('subscription'));
const ALLOWED_MODULES = new Set(MODULE_BY_NAME.keys());
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
  return Array.isArray(PROFILE_MODULES[scanProfile]) ? [...PROFILE_MODULES[scanProfile]] : [];
}

function normalizeOptionalSubscriptionList(azure) {
  const raw = Array.isArray(azure?.subscriptionIds)
    ? azure.subscriptionIds
    : Array.isArray(azure?.subscriptions)
      ? azure.subscriptions
      : [];
  const normalized = raw.map((item) => normalizeUuid(item, 'azure.subscriptionIds[]'));
  if (new Set(normalized).size !== normalized.length) throw new ValidationError('azure.subscriptionIds cannot contain duplicates.');
  return normalized.sort();
}

function validateAzurePayload(scanProfile, azure, normalizedModules = PROFILE_MODULES[scanProfile] || []) {
  const input = azure && typeof azure === 'object' ? azure : {};
  if (azure !== undefined && azure !== null && (typeof azure !== 'object' || Array.isArray(azure))) {
    throw new ValidationError('azure must be a JSON object when provided.');
  }
  const normalized = { targetUrl: null, microsoftTenantId: null, subscriptions: [] };
  const modules = Array.isArray(normalizedModules) ? normalizedModules : [];
  const needsWebTarget = modules.some((item) => MODULE_BY_NAME.get(item)?.scope === 'web');
  const needsAzureTenantScope = modules.some((item) => ['tenant', 'subscription'].includes(MODULE_BY_NAME.get(item)?.scope));
  const needsAzureSubscriptions = modules.some((item) => INFRA_MODULE_SET.has(item));
  if (needsWebTarget) {
    if (!input.targetUrl) throw new ValidationError('azure.targetUrl is required when the web module is requested.');
    normalized.targetUrl = normalizeHttpsTargetUrl(input.targetUrl).url;
  }
  if (input.microsoftTenantId) normalized.microsoftTenantId = normalizeUuid(input.microsoftTenantId, 'azure.microsoftTenantId');
  if (needsAzureSubscriptions) normalized.subscriptions = normalizeOptionalSubscriptionList(input);
  if (needsAzureTenantScope && !normalized.microsoftTenantId && normalized.subscriptions.length === 0) {
    // The authorization service can resolve the only verified tenant/scope.
    normalized.microsoftTenantId = null;
  }
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
  resolveBillingUnits,
};
