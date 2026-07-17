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

const MODULE_REGISTRY = {
  storage: { runner: (subscriptions, credential) => auditStorage(subscriptions, credential) },
  vms: { runner: (subscriptions, credential) => auditVMs(subscriptions, credential) },
  nsg: { runner: (subscriptions, credential) => auditNsg(subscriptions, credential) },
  keyvault: { runner: (subscriptions, credential) => auditKeyVault(subscriptions, credential) },
  logs: { runner: (subscriptions, credential) => auditLogs(subscriptions, credential) },
  db: { runner: (subscriptions, credential) => auditDb(subscriptions, credential) },
  governance: { runner: (subscriptions, credential) => auditGovernance(subscriptions, credential) },
  appservices: { runner: (subscriptions, credential) => auditAppServices(subscriptions, credential) },
  finops: { runner: (subscriptions, credential) => auditFinOps(subscriptions, credential) },
  entra_b2b: { runner: (_subscriptions, credential, microsoftTenantId) => auditEntraB2B(microsoftTenantId || 'common', credential) },
  tags: { runner: (subscriptions, credential) => auditTags(subscriptions, credential) },
  exposure_map: { runner: (subscriptions, credential) => auditExposureMap(subscriptions, credential) },
  diagnostic_coverage: { runner: (subscriptions, credential) => auditDiagnosticCoverage(subscriptions, credential) },
  encryption_coverage: { runner: (subscriptions, credential) => auditEncryptionCoverage(subscriptions, credential) },
  azure_rbac_exposure: { runner: (subscriptions, credential) => auditAzureRbacExposure(subscriptions, credential) },
  private_link_coverage: { runner: (subscriptions, credential) => auditPrivateLinkCoverage(subscriptions, credential) },
  policy_compliance: { runner: (subscriptions, credential) => auditPolicyCompliance(subscriptions, credential) }
};

async function runModuleWithRetry(moduleName, subscriptions, credential, microsoftTenantId, logger) {
  const descriptor = MODULE_REGISTRY[moduleName];
  if (!descriptor) return { status: 'FAILED', error: `Unsupported Azure infra module: ${moduleName}` };
  try {
    return await withRetry(() => descriptor.runner(subscriptions, credential, microsoftTenantId), { label: `azure.module.${moduleName}`, retries: 2, logger });
  } catch (error) {
    logger?.error?.({ err: error, moduleName }, 'Unhandled Azure infra module error after retries.');
    return { status: 'FAILED', error: error.message };
  }
}

async function auditAzureInfra(subscriptions, credential, requestedModules, microsoftTenantId = null, options = {}) {
  const logger = options.logger || console;
  const modulesToRun = (requestedModules || []).filter((moduleName) => Object.prototype.hasOwnProperty.call(MODULE_REGISTRY, moduleName));
  if (modulesToRun.length === 0) return null;
  logger.info?.({ modulesToRun }, '[AZURE-INFRA] Starting infrastructure orchestrator.');
  const startTime = Date.now();
  const entries = await Promise.all(modulesToRun.map(async (moduleName) => {
    const rawResult = await runModuleWithRetry(moduleName, subscriptions, credential, microsoftTenantId, logger);
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
