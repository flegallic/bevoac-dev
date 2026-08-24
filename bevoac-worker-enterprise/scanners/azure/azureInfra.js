'use strict';

const { auditStorage } = require('./storage');
const { auditVMs } = require('./vms');
const { auditNsg } = require('./nsg');
const { auditKeyVault } = require('./keyvault');
const { auditDb } = require('./db');
const { auditLogs } = require('./logs');
const { auditGovernance } = require('./governance');
const { auditAppServices } = require('./appservices');
const { auditFinOps } = require('./finops');
const { auditEntraB2B } = require('./entra_b2b');
const { auditTags } = require('./tags');
const { auditDiagnosticCoverage } = require('./diagnostic_coverage');
const { auditEncryptionCoverage } = require('./encryption_coverage');
const { auditAzureRbacExposure } = require('./azure_rbac_exposure');
const { auditPrivateLinkCoverage } = require('./private_link_coverage');
const { auditPolicyCompliance } = require('./policy_compliance');
const { auditExposureMap } = require('./exposure_map');
const { withRetry } = require('../../src/lib/retry');
const { decorateModuleStatus, rollupExecutionStatus, rollupSecurityPosture } = require('../../src/lib/status-semantics');
const { enhanceModuleResult } = require('../../src/lib/module-enhancers');
const { WORKER_REGISTRY_MODULES } = require('../../src/lib/module-catalog');
const { isRetryableError, safeErrorProjection } = require('../../src/lib/worker-errors');
const { throwIfAborted } = require('../../src/lib/abort');

const MODULE_REGISTRY = {
  storage: { runner: (subscriptions, credential, _tenant, options) => auditStorage(subscriptions, credential, options) },
  vms: { runner: (subscriptions, credential, _tenant, options) => auditVMs(subscriptions, credential, options) },
  nsg: { runner: (subscriptions, credential, _tenant, options) => auditNsg(subscriptions, credential, options) },
  keyvault: { runner: (subscriptions, credential, _tenant, options) => auditKeyVault(subscriptions, credential, options) },
  logs: { runner: (subscriptions, credential, _tenant, options) => auditLogs(subscriptions, credential, options) },
  db: { runner: (subscriptions, credential, _tenant, options) => auditDb(subscriptions, credential, options) },
  governance: { runner: (subscriptions, credential, _tenant, options) => auditGovernance(subscriptions, credential, options) },
  appservices: { runner: (subscriptions, credential, _tenant, options) => auditAppServices(subscriptions, credential, options) },
  finops: { runner: (subscriptions, credential, _tenant, options) => auditFinOps(subscriptions, credential, options) },
  entra_b2b: { runner: (_subscriptions, credential, microsoftTenantId, options) => auditEntraB2B(microsoftTenantId || 'common', credential, options) },
  tags: { runner: (subscriptions, credential, _tenant, options) => auditTags(subscriptions, credential, options) },
  exposure_map: { runner: (subscriptions, credential, _tenant, options) => auditExposureMap(subscriptions, credential, options) },
  diagnostic_coverage: { runner: (subscriptions, credential, _tenant, options) => auditDiagnosticCoverage(subscriptions, credential, options) },
  encryption_coverage: { runner: (subscriptions, credential, _tenant, options) => auditEncryptionCoverage(subscriptions, credential, options) },
  azure_rbac_exposure: { runner: (subscriptions, credential, _tenant, options) => auditAzureRbacExposure(subscriptions, credential, options) },
  private_link_coverage: { runner: (subscriptions, credential, _tenant, options) => auditPrivateLinkCoverage(subscriptions, credential, options) },
  policy_compliance: { runner: (subscriptions, credential, _tenant, options) => auditPolicyCompliance(subscriptions, credential, options) }
};

const registryNames = Object.keys(MODULE_REGISTRY).sort();
const catalogRegistryNames = [...WORKER_REGISTRY_MODULES].sort();
if (JSON.stringify(registryNames) !== JSON.stringify(catalogRegistryNames)) {
  throw new Error(`Azure module registry/catalog mismatch. registry=${registryNames.join(',')} catalog=${catalogRegistryNames.join(',')}`);
}

async function runModuleWithRetry(moduleName, subscriptions, credential, microsoftTenantId, logger, signal = null) {
  throwIfAborted(signal, `Azure module ${moduleName}`);
  const descriptor = MODULE_REGISTRY[moduleName];
  if (!descriptor) return { status: 'FAILED', error: `Unsupported Azure infra module: ${moduleName}` };
  try {
    return await withRetry(({ signal: retrySignal }) => {
      throwIfAborted(retrySignal, `Azure module ${moduleName}`);
      return descriptor.runner(subscriptions, credential, microsoftTenantId, { signal: retrySignal, logger });
    }, { label: `azure.module.${moduleName}`, retries: 2, logger, signal });
  } catch (error) {
    logger?.error?.({ error: safeErrorProjection(error), moduleName }, 'Unhandled Azure infra module error after retries.');
    if (isRetryableError(error)) throw error;
    return {
      status: 'FAILED',
      error: 'Azure module execution failed.',
      errorCode: String(error?.code || 'AZURE_MODULE_FAILED').slice(0, 120),
      details: { partialErrors: [{ code: String(error?.code || 'AZURE_MODULE_FAILED').slice(0, 120), message: 'Azure module execution failed.' }] }
    };
  }
}

async function auditAzureInfra(subscriptions, credential, requestedModules, microsoftTenantId = null, options = {}) {
  const logger = options.logger || console;
  const signal = options.signal || null;
  throwIfAborted(signal, 'Azure infrastructure audit');
  const modulesToRun = (requestedModules || []).filter((moduleName) => Object.prototype.hasOwnProperty.call(MODULE_REGISTRY, moduleName));
  if (modulesToRun.length === 0) return null;
  logger.info?.({ modulesToRun }, '[AZURE-INFRA] Starting infrastructure orchestrator.');
  const startTime = Date.now();
  const entries = await Promise.all(modulesToRun.map(async (moduleName) => {
    const rawResult = await runModuleWithRetry(moduleName, subscriptions, credential, microsoftTenantId, logger, signal);
    const enhanced = enhanceModuleResult(moduleName, rawResult);
    return [moduleName, decorateModuleStatus(enhanced)];
  }));
  const modules = Object.fromEntries(entries);
  const executionStatus = rollupExecutionStatus(modules);
  const securityPosture = rollupSecurityPosture(modules);
  const kpis = Object.entries(modules).flatMap(([moduleName, moduleResult]) => (moduleResult.kpis || []).map((kpi) => ({ ...kpi, sourceModule: moduleName })));
  return { status: executionStatus, executionStatus, securityPosture, duration_ms: Date.now() - startTime, modules, kpis };
}

module.exports = { auditAzureInfra, MODULE_REGISTRY };
