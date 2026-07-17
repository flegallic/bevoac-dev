'use strict';

const {
  coverageKpi,
  riskCountKpi,
  mergeKpis,
  countChecksByStatus,
  buildModuleEvidenceMetadata,
  finiteNumber
} = require('./kpi-engine');

function total(summary, keys) {
  for (const key of keys) {
    const value = summary?.[key];
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function enhanceStorage(result) {
  const s = result.summary || {};
  const totalStorage = total(s, ['totalStorageAccounts']);
  const publicCount = finiteNumber(s.publicStorageAccountsCount, 0);
  const blobPublicCount = finiteNumber(s.storageWithBlobPublicAccessEnabledCount, 0);
  const sharedKeyCount = finiteNumber(s.storageWithSharedKeyAccessEnabledCount, 0);
  const tlsWeakCount = finiteNumber(s.storageWithMinTlsBelow12Count, 0);
  const localUsersCount = finiteNumber(s.storageWithLocalUsersEnabledCount, 0);
  return mergeKpis(
    coverageKpi({ kpiId: 'STORAGE_NON_PUBLIC_COVERAGE', label: '% de comptes de stockage non publics', domain: 'cloud_security', compliant: Math.max(totalStorage - publicCount, 0), total: totalStorage, evidenceSource: 'azure_infrastructure.modules.storage.summary.publicStorageAccountsCount', warningBelow: 95, criticalBelow: 85, recommendation: 'Restreindre les comptes Storage publics et privilégier Private Link pour les données sensibles.' }),
    coverageKpi({ kpiId: 'STORAGE_BLOB_PUBLIC_ACCESS_DISABLED', label: '% de comptes Storage avec accès blob public désactivé', domain: 'cloud_security', compliant: Math.max(totalStorage - blobPublicCount, 0), total: totalStorage, evidenceSource: 'azure_infrastructure.modules.storage.summary.storageWithBlobPublicAccessEnabledCount', warningBelow: 98, criticalBelow: 90 }),
    coverageKpi({ kpiId: 'STORAGE_SHARED_KEY_DISABLED', label: '% de comptes Storage sans Shared Key active', domain: 'cloud_security', compliant: Math.max(totalStorage - sharedKeyCount, 0), total: totalStorage, evidenceSource: 'azure_infrastructure.modules.storage.summary.storageWithSharedKeyAccessEnabledCount', warningBelow: 90, criticalBelow: 70 }),
    coverageKpi({ kpiId: 'STORAGE_TLS_BASELINE', label: '% de comptes Storage TLS >= 1.2', domain: 'cloud_security', compliant: Math.max(totalStorage - tlsWeakCount, 0), total: totalStorage, evidenceSource: 'azure_infrastructure.modules.storage.summary.storageWithMinTlsBelow12Count', warningBelow: 99, criticalBelow: 90 }),
    coverageKpi({ kpiId: 'STORAGE_LOCAL_USERS_DISABLED', label: '% de comptes Storage sans utilisateurs locaux', domain: 'cloud_security', compliant: Math.max(totalStorage - localUsersCount, 0), total: totalStorage, evidenceSource: 'azure_infrastructure.modules.storage.summary.storageWithLocalUsersEnabledCount', warningBelow: 95, criticalBelow: 85 })
  );
}

function enhanceLogs(result) {
  const s = result.summary || {};
  const totalWorkspaces = total(s, ['totalWorkspaces']);
  const shortRetention = finiteNumber(s.shortRetentionWorkspacesCount, 0);
  const missingWorkspaces = finiteNumber(s.missingWorkspacesCount, 0);
  return mergeKpis(
    riskCountKpi({ kpiId: 'LOG_SUBSCRIPTIONS_WITHOUT_WORKSPACE', label: 'Subscriptions sans Log Analytics Workspace', domain: 'logging', count: missingWorkspaces, evidenceSource: 'azure_infrastructure.modules.logs.summary.missingWorkspacesCount', warningAt: 1, criticalAt: 3, recommendation: 'Déployer un workspace Log Analytics et configurer les ressources critiques vers ce workspace.' }),
    coverageKpi({ kpiId: 'LOG_RETENTION_90D_COVERAGE', label: '% de workspaces avec rétention >= 90 jours', domain: 'logging', compliant: Math.max(totalWorkspaces - shortRetention, 0), total: totalWorkspaces, evidenceSource: 'azure_infrastructure.modules.logs.summary.shortRetentionWorkspacesCount', warningBelow: 95, criticalBelow: 80 })
  );
}

function enhanceVms(result) {
  const s = result.summary || {};
  const totalVms = total(s, ['totalVMs']);
  return mergeKpis(
    coverageKpi({ kpiId: 'VM_DISK_ENCRYPTION_COVERAGE', label: '% de VMs sans disque explicitement non chiffré', domain: 'encryption', compliant: Math.max(totalVms - finiteNumber(s.unencryptedDisksVMsCount, 0), 0), total: totalVms, evidenceSource: 'azure_infrastructure.modules.vms.summary.unencryptedDisksVMsCount', warningBelow: 99, criticalBelow: 95 }),
    coverageKpi({ kpiId: 'VM_TRUSTED_LAUNCH_COVERAGE', label: '% de VMs avec Trusted Launch', domain: 'cloud_security', compliant: Math.max(totalVms - finiteNumber(s.noTrustedLaunchVMsCount, 0), 0), total: totalVms, evidenceSource: 'azure_infrastructure.modules.vms.summary.noTrustedLaunchVMsCount', warningBelow: 80, criticalBelow: 50 }),
    coverageKpi({ kpiId: 'VM_MANAGED_IDENTITY_COVERAGE', label: '% de VMs avec Managed Identity', domain: 'identity', compliant: Math.max(totalVms - finiteNumber(s.noManagedIdentityVMsCount, 0), 0), total: totalVms, evidenceSource: 'azure_infrastructure.modules.vms.summary.noManagedIdentityVMsCount', warningBelow: 70, criticalBelow: 40 }),
    riskCountKpi({ kpiId: 'VM_PUBLIC_ADMIN_PORT_EXPOSURE', label: 'VMs avec ports admin exposés', domain: 'network_exposure', count: finiteNumber(s.publicAdminPortsVMsCount, 0), evidenceSource: 'azure_infrastructure.modules.vms.summary.publicAdminPortsVMsCount', warningAt: 1, criticalAt: 1, recommendation: 'Supprimer les IP publiques directes, utiliser Azure Bastion/JIT et restreindre les NSG.' })
  );
}

function enhanceNsg(result) {
  const s = result.summary || {};
  const totalNsgs = total(s, ['totalNsgs']);
  const risky = finiteNumber(s.permissiveSshRdpCount, 0) + finiteNumber(s.permissiveDatabaseCount, 0) + finiteNumber(s.permissiveAnyCount, 0);
  return mergeKpis(
    coverageKpi({ kpiId: 'NSG_RESTRICTED_INBOUND_COVERAGE', label: '% de NSG sans exposition inbound critique', domain: 'network_exposure', compliant: Math.max(totalNsgs - risky, 0), total: totalNsgs, evidenceSource: 'azure_infrastructure.modules.nsg.summary', warningBelow: 95, criticalBelow: 85 }),
    riskCountKpi({ kpiId: 'NSG_ADMIN_PORTS_PUBLIC', label: 'Règles NSG exposant SSH/RDP', domain: 'network_exposure', count: finiteNumber(s.permissiveSshRdpCount, 0), evidenceSource: 'azure_infrastructure.modules.nsg.summary.permissiveSshRdpCount', warningAt: 1, criticalAt: 1 })
  );
}

function enhanceKeyVault(result) {
  const s = result.summary || {};
  const totalVaults = total(s, ['totalVaults']);
  return mergeKpis(
    coverageKpi({ kpiId: 'KEYVAULT_NON_PUBLIC_COVERAGE', label: '% de Key Vaults sans accès public permissif', domain: 'cloud_security', compliant: Math.max(totalVaults - finiteNumber(s.publiclyAccessibleCount, 0), 0), total: totalVaults, evidenceSource: 'azure_infrastructure.modules.keyvault.summary.publiclyAccessibleCount', warningBelow: 100, criticalBelow: 95 }),
    coverageKpi({ kpiId: 'KEYVAULT_PURGE_PROTECTION_COVERAGE', label: '% de Key Vaults avec purge protection', domain: 'cloud_security', compliant: Math.max(totalVaults - finiteNumber(s.missingPurgeProtectionCount, 0), 0), total: totalVaults, evidenceSource: 'azure_infrastructure.modules.keyvault.summary.missingPurgeProtectionCount', warningBelow: 100, criticalBelow: 90 }),
    coverageKpi({ kpiId: 'KEYVAULT_PRIVATE_ENDPOINT_COVERAGE', label: '% de Key Vaults avec Private Endpoint', domain: 'private_networking', compliant: finiteNumber(s.vaultsWithPrivateEndpointCount, 0), total: totalVaults, evidenceSource: 'azure_infrastructure.modules.keyvault.summary.vaultsWithPrivateEndpointCount', warningBelow: 80, criticalBelow: 50 }),
    coverageKpi({ kpiId: 'KEYVAULT_RBAC_AUTH_COVERAGE', label: '% de Key Vaults en mode RBAC', domain: 'identity', compliant: finiteNumber(s.vaultsWithRbacAuthorizationCount, 0), total: totalVaults, evidenceSource: 'azure_infrastructure.modules.keyvault.summary.vaultsWithRbacAuthorizationCount', warningBelow: 80, criticalBelow: 50 })
  );
}

function enhanceDb(result) {
  const s = result.summary || {};
  const totalDbs = total(s, ['totalDbs']);
  return mergeKpis(
    coverageKpi({ kpiId: 'DB_PRIVATE_ACCESS_COVERAGE', label: '% de bases sans public network access', domain: 'private_networking', compliant: Math.max(totalDbs - finiteNumber(s.publicAccessEnabledCount, 0), 0), total: totalDbs, evidenceSource: 'azure_infrastructure.modules.db.summary.publicAccessEnabledCount', warningBelow: 95, criticalBelow: 80 }),
    coverageKpi({ kpiId: 'DB_TLS_BASELINE_COVERAGE', label: '% de bases TLS >= 1.2', domain: 'cloud_security', compliant: Math.max(totalDbs - finiteNumber(s.outdatedTlsCount, 0), 0), total: totalDbs, evidenceSource: 'azure_infrastructure.modules.db.summary.outdatedTlsCount', warningBelow: 100, criticalBelow: 90 }),
    riskCountKpi({ kpiId: 'DB_ALLOW_AZURE_SERVICES_RULES', label: 'Bases avec règle Allow Azure Services', domain: 'network_exposure', count: finiteNumber(s.allowsAzureServicesCount, 0), evidenceSource: 'azure_infrastructure.modules.db.summary.allowsAzureServicesCount', warningAt: 1, criticalAt: 3 })
  );
}

function enhanceGovernance(result) {
  const s = result.summary || {};
  const totalSubscriptions = total(s, ['totalSubscriptions']);
  return mergeKpis(
    coverageKpi({ kpiId: 'DEFENDER_FOR_CLOUD_COVERAGE', label: '% de subscriptions avec Defender for Cloud actif', domain: 'governance', compliant: Math.max(totalSubscriptions - finiteNumber(s.missingDefenderCount, 0), 0), total: totalSubscriptions, evidenceSource: 'azure_infrastructure.modules.governance.summary.missingDefenderCount', warningBelow: 90, criticalBelow: 70 }),
    coverageKpi({ kpiId: 'SECURITY_POLICY_ASSIGNMENT_COVERAGE', label: '% de subscriptions avec initiative sécurité assignée', domain: 'governance', compliant: Math.max(totalSubscriptions - finiteNumber(s.missingSecurityPolicyCount, 0), 0), total: totalSubscriptions, evidenceSource: 'azure_infrastructure.modules.governance.summary.missingSecurityPolicyCount', warningBelow: 90, criticalBelow: 70 })
  );
}

function enhanceAppServices(result) {
  const s = result.summary || {};
  const totalApps = total(s, ['totalApps']);
  return mergeKpis(
    coverageKpi({ kpiId: 'APPSERVICE_HTTPS_ONLY_COVERAGE', label: '% App Services HTTPS Only', domain: 'web_paas_security', compliant: Math.max(totalApps - finiteNumber(s.httpNotRedirectedCount, 0), 0), total: totalApps, evidenceSource: 'azure_infrastructure.modules.appservices.summary.httpNotRedirectedCount', warningBelow: 98, criticalBelow: 90 }),
    coverageKpi({ kpiId: 'APPSERVICE_BASIC_AUTH_DISABLED', label: '% App Services sans Basic Auth publishing', domain: 'web_paas_security', compliant: Math.max(totalApps - finiteNumber(s.basicAuthEnabledCount, 0), 0), total: totalApps, evidenceSource: 'azure_infrastructure.modules.appservices.summary.basicAuthEnabledCount', warningBelow: 95, criticalBelow: 85 }),
    coverageKpi({ kpiId: 'APPSERVICE_FTP_DISABLED_OR_FTPS_ONLY', label: '% App Services sans FTP non sécurisé', domain: 'web_paas_security', compliant: Math.max(totalApps - finiteNumber(s.ftpEnabledCount, 0), 0), total: totalApps, evidenceSource: 'azure_infrastructure.modules.appservices.summary.ftpEnabledCount', warningBelow: 95, criticalBelow: 85 })
  );
}

function enhanceEntra(result) {
  const s = result.summary || {};
  const totalUsers = total(s, ['totalUsers']);
  const globalAdmins = finiteNumber(s.globalAdmins, 0);
  return mergeKpis(
    coverageKpi({ kpiId: 'ENTRA_MFA_USER_COVERAGE', label: '% utilisateurs avec MFA enregistré', domain: 'identity', compliant: finiteNumber(s.mfaRegisteredUsers, 0), total: totalUsers, evidenceSource: 'microsoft_entra.summary.mfaRegisteredUsers', warningBelow: 95, criticalBelow: 85 }),
    riskCountKpi({ kpiId: 'ENTRA_GLOBAL_ADMIN_COUNT', label: 'Nombre de Global Administrators', domain: 'privileged_access', count: globalAdmins, evidenceSource: 'microsoft_entra.summary.globalAdmins', warningAt: 6, criticalAt: 10, recommendation: 'Limiter les administrateurs permanents et privilégier PIM/JIT.' }),
    riskCountKpi({ kpiId: 'ENTRA_INACTIVE_USERS_30D', label: 'Comptes actifs dormants > 30 jours', domain: 'identity_hygiene', count: finiteNumber(s.inactiveUsersOver30d, 0), evidenceSource: 'microsoft_entra.summary.inactiveUsersOver30d', warningAt: 1, criticalAt: 25 }),
    riskCountKpi({ kpiId: 'ENTRA_HIGH_RISK_SIGNINS', label: 'Sign-ins à risque élevé', domain: 'identity_risk', count: finiteNumber(s.highRiskSignInsCount, 0), evidenceSource: 'microsoft_entra.summary.highRiskSignInsCount', warningAt: 1, criticalAt: 1 })
  );
}

function enhanceEntraB2B(result) {
  const s = result.summary || {};
  const totalGuests = total(s, ['totalGuests']);
  return mergeKpis(
    coverageKpi({ kpiId: 'ENTRA_B2B_GUEST_MFA_COVERAGE', label: '% invités B2B avec MFA', domain: 'external_identity', compliant: Math.max(totalGuests - finiteNumber(s.guestsMissingMfaCount, 0), 0), total: totalGuests, evidenceSource: 'azure_infrastructure.modules.entra_b2b.summary.guestsMissingMfaCount', warningBelow: 95, criticalBelow: 85 }),
    riskCountKpi({ kpiId: 'ENTRA_B2B_STALE_GUESTS', label: 'Invités B2B dormants', domain: 'external_identity', count: finiteNumber(s.staleGuestsCount, 0), evidenceSource: 'azure_infrastructure.modules.entra_b2b.summary.staleGuestsCount', warningAt: 1, criticalAt: 25 }),
    riskCountKpi({ kpiId: 'ENTRA_B2B_GUEST_ADMINS', label: 'Invités B2B administrateurs', domain: 'external_identity', count: finiteNumber(s.guestAdminsCount, 0), evidenceSource: 'azure_infrastructure.modules.entra_b2b.summary.guestAdminsCount', warningAt: 1, criticalAt: 1 })
  );
}

function enhanceFinOps(result) {
  const s = result.summary || {};
  return mergeKpis(
    riskCountKpi({ kpiId: 'FINOPS_ORPHANED_DISKS', label: 'Disques orphelins', domain: 'finops', count: finiteNumber(s.orphanedDisksCount, 0), evidenceSource: 'azure_infrastructure.modules.finops.summary.orphanedDisksCount', warningAt: 1, criticalAt: 25 }),
    riskCountKpi({ kpiId: 'FINOPS_UNATTACHED_PUBLIC_IPS', label: 'IP publiques non attachées', domain: 'finops', count: finiteNumber(s.unattachedPublicIpsCount, 0), evidenceSource: 'azure_infrastructure.modules.finops.summary.unattachedPublicIpsCount', warningAt: 1, criticalAt: 25 })
  );
}

function enhanceWeb(result) {
  const checks = result.checks || [];
  const failed = checks.filter((check) => String(check.status).toUpperCase() === 'FAILED').length;
  const totalChecks = checks.length;
  return mergeKpis(
    coverageKpi({ kpiId: 'WEB_SECURITY_CHECK_PASS_RATE', label: '% contrôles web sans finding FAILED', domain: 'web_security', compliant: Math.max(totalChecks - failed, 0), total: totalChecks, evidenceSource: 'webSecurity.findings', warningBelow: 80, criticalBelow: 50 })
  );
}

const ENHANCERS = {
  storage: enhanceStorage,
  logs: enhanceLogs,
  vms: enhanceVms,
  nsg: enhanceNsg,
  keyvault: enhanceKeyVault,
  db: enhanceDb,
  governance: enhanceGovernance,
  appservices: enhanceAppServices,
  entra: enhanceEntra,
  entra_b2b: enhanceEntraB2B,
  finops: enhanceFinOps,
  web: enhanceWeb
};

function enhanceModuleResult(moduleName, result, resourceTypes = []) {
  if (!result || typeof result !== 'object') return result;
  const existingKpis = Array.isArray(result.kpis) ? result.kpis : [];
  const extraKpis = ENHANCERS[moduleName] ? ENHANCERS[moduleName](result) : [];
  const checksByStatus = countChecksByStatus(result.checks || []);
  return {
    ...result,
    kpis: mergeKpis(existingKpis, extraKpis),
    coverage: result.coverage || { checksByStatus },
    evidenceMetadata: result.evidenceMetadata || buildModuleEvidenceMetadata(moduleName, result, resourceTypes)
  };
}

module.exports = { enhanceModuleResult, ENHANCERS };
