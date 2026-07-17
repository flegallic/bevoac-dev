'use strict';

const { auditStorage } = require('./storage');
const { auditNsg } = require('./nsg');
const { auditKeyVault } = require('./keyvault');
const { auditDb } = require('./db');
const { auditAppServices } = require('./appservices');
const { auditVMs } = require('./vms');
const { riskCountKpi, buildModuleEvidenceMetadata } = require('../../src/lib/kpi-engine');

const MODULE_NAME = 'exposure_map';

async function settle(label, fn) {
  try {
    return { label, result: await fn() };
  } catch (error) {
    return { label, result: { status: 'FAILED', error: error.message, checks: [], summary: {}, details: { partialErrors: [{ message: error.message }] } } };
  }
}

function sampleFrom(result, path, limit = 10) {
  const parts = path.split('.');
  let current = result;
  for (const part of parts) current = current?.[part];
  return Array.isArray(current) ? current.slice(0, limit) : [];
}

async function auditExposureMap(subscriptions, credential) {
  const startTime = Date.now();
  const [storage, nsg, keyvault, db, appservices, vms] = await Promise.all([
    settle('storage', () => auditStorage(subscriptions, credential)),
    settle('nsg', () => auditNsg(subscriptions, credential)),
    settle('keyvault', () => auditKeyVault(subscriptions, credential)),
    settle('db', () => auditDb(subscriptions, credential)),
    settle('appservices', () => auditAppServices(subscriptions, credential)),
    settle('vms', () => auditVMs(subscriptions, credential))
  ]);

  const modules = { storage: storage.result, nsg: nsg.result, keyvault: keyvault.result, db: db.result, appservices: appservices.result, vms: vms.result };
  const publicStorageCount = Number(modules.storage?.summary?.publicStorageAccountsCount || 0);
  const publicBlobAccessCount = Number(modules.storage?.summary?.storageWithBlobPublicAccessEnabledCount || 0);
  const publicKeyVaultCount = Number(modules.keyvault?.summary?.publiclyAccessibleCount || 0);
  const publicDbCount = Number(modules.db?.summary?.publicAccessEnabledCount || 0);
  const publicAdminVmCount = Number(modules.vms?.summary?.publicAdminPortsVMsCount || 0);
  const permissiveNsgCount = Number(modules.nsg?.summary?.permissiveSshRdpCount || 0) + Number(modules.nsg?.summary?.permissiveDatabaseCount || 0) + Number(modules.nsg?.summary?.permissiveAnyCount || 0);
  const appHttpCount = Number(modules.appservices?.summary?.httpNotRedirectedCount || 0);
  const totalExposureSignals = publicStorageCount + publicBlobAccessCount + publicKeyVaultCount + publicDbCount + publicAdminVmCount + permissiveNsgCount + appHttpCount;

  const details = {
    publicStorageAccounts: sampleFrom(modules.storage, 'details.publicStorageAccounts'),
    storageWithBlobPublicAccessEnabled: sampleFrom(modules.storage, 'details.storageWithBlobPublicAccessEnabled'),
    publiclyAccessibleKeyVaults: sampleFrom(modules.keyvault, 'details.publiclyAccessible'),
    publicDatabases: sampleFrom(modules.db, 'details.publicAccessEnabled'),
    publicAdminPortsVMs: sampleFrom(modules.vms, 'details.publicAdminPortsVMs'),
    permissiveNsgRules: [
      ...sampleFrom(modules.nsg, 'details.permissiveSshRdp'),
      ...sampleFrom(modules.nsg, 'details.permissiveDatabase'),
      ...sampleFrom(modules.nsg, 'details.permissiveAny')
    ].slice(0, 10),
    appServicesWithoutHttpsOnly: sampleFrom(modules.appservices, 'details.httpNotRedirected'),
    moduleSnapshots: modules
  };

  const result = {
    status: 'SUCCESS',
    duration_ms: Date.now() - startTime,
    summary: {
      publicStorageCount,
      publicBlobAccessCount,
      publicKeyVaultCount,
      publicDbCount,
      publicAdminVmCount,
      permissiveNsgCount,
      appHttpCount,
      totalExposureSignals,
      partialErrorsCount: Object.values(modules).filter((moduleResult) => moduleResult?.status === 'FAILED').length
    },
    details,
    checks: [],
    kpis: [
      riskCountKpi({ kpiId: 'EXPOSURE_TOTAL_SIGNALS', label: 'Signaux d’exposition publique consolidés', domain: 'exposure_map', count: totalExposureSignals, warningAt: 1, criticalAt: 5, evidenceSource: 'azure_infrastructure.modules.exposure_map.summary.totalExposureSignals' }),
      riskCountKpi({ kpiId: 'EXPOSURE_PUBLIC_ADMIN_VM_COUNT', label: 'VMs avec administration exposée', domain: 'exposure_map', count: publicAdminVmCount, warningAt: 1, criticalAt: 1, evidenceSource: 'azure_infrastructure.modules.exposure_map.details.publicAdminPortsVMs' }),
      riskCountKpi({ kpiId: 'EXPOSURE_PUBLIC_DATA_SERVICES', label: 'Services de données exposés publiquement', domain: 'exposure_map', count: publicStorageCount + publicKeyVaultCount + publicDbCount, warningAt: 1, criticalAt: 3, evidenceSource: 'azure_infrastructure.modules.exposure_map.details' })
    ]
  };

  if (totalExposureSignals > 0) {
    result.checks.push({
      checkId: 'CHECK-AZ-EXPOSURE-001',
      area: 'Public Exposure Map',
      resourceType: 'Multiple Azure resource types',
      status: 'FAILED',
      severity: publicAdminVmCount > 0 || publicDbCount > 0 || publicKeyVaultCount > 0 ? 'CRITICAL' : 'HIGH',
      title: 'Public exposure signals were detected across Azure resources',
      description: 'The consolidated exposure map found at least one public exposure signal across Storage, Key Vault, DB, NSG, VM or App Service controls.',
      recommendation: 'Prioritize exposure remediation by removing public admin paths, restricting data services, enforcing HTTPS and using Private Link where applicable.',
      affectedResourcesCount: totalExposureSignals,
      affectedResourcesSample: [
        ...details.publicAdminPortsVMs,
        ...details.publicDatabases,
        ...details.publiclyAccessibleKeyVaults,
        ...details.publicStorageAccounts,
        ...details.permissiveNsgRules,
        ...details.appServicesWithoutHttpsOnly
      ].slice(0, 10)
    });
  } else {
    result.checks.push({
      checkId: 'CHECK-AZ-EXPOSURE-001',
      area: 'Public Exposure Map',
      resourceType: 'Multiple Azure resource types',
      status: 'PASSED',
      severity: 'INFO',
      title: 'No consolidated public exposure signal detected',
      description: 'No public exposure signal was detected by the modules used to build the exposure map.',
      recommendation: 'Continue monitoring exposure drift and re-run scans after infrastructure changes.',
      affectedResourcesCount: 0,
      affectedResourcesSample: []
    });
  }

  if (result.summary.partialErrorsCount > 0 && totalExposureSignals === 0) result.status = 'WARNING';
  result.evidenceMetadata = buildModuleEvidenceMetadata(MODULE_NAME, result, ['Multiple Azure resource types']);
  return result;
}

module.exports = { auditExposureMap };
