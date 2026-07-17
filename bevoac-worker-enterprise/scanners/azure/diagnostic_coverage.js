'use strict';

const { runResourceGraphQuery } = require('../../src/lib/resource-graph');
const { coverageKpi, riskCountKpi, buildModuleEvidenceMetadata } = require('../../src/lib/kpi-engine');

const MODULE_NAME = 'diagnostic_coverage';
const CRITICAL_TYPES = [
  'microsoft.keyvault/vaults',
  'microsoft.storage/storageaccounts',
  'microsoft.network/networksecuritygroups',
  'microsoft.sql/servers',
  'microsoft.dbforpostgresql/flexibleservers',
  'microsoft.web/sites'
];

function lower(value) { return String(value || '').toLowerCase(); }
function parentIdFromDiagnosticId(id) {
  return String(id || '').replace(/\/providers\/microsoft\.insights\/diagnosticsettings\/[^/]+$/i, '').toLowerCase();
}

async function auditDiagnosticCoverage(subscriptions, credential) {
  const startTime = Date.now();
  const result = {
    status: 'PENDING',
    checks: [],
    details: { resources: [], resourcesWithoutDiagnostics: [], diagnosticSettings: [], partialErrors: [] },
    summary: { totalCriticalResources: 0, resourcesWithDiagnosticsCount: 0, resourcesWithoutDiagnosticsCount: 0, partialErrorsCount: 0 }
  };

  try {
    const typeList = CRITICAL_TYPES.map((type) => `'${type}'`).join(', ');
    const resourcesQuery = `resources | where tolower(type) in (${typeList}) | project id, name, type, location, resourceGroup, subscriptionId`;
    const diagnosticsQuery = `resources | where tolower(type) == 'microsoft.insights/diagnosticsettings' | project id, name, type, subscriptionId`;
    const [resources, diagnosticSettings] = await Promise.all([
      runResourceGraphQuery(credential, subscriptions, resourcesQuery),
      runResourceGraphQuery(credential, subscriptions, diagnosticsQuery).catch((error) => {
        result.details.partialErrors.push({ scope: 'ResourceGraph/diagnosticsettings', message: error.message });
        return [];
      })
    ]);

    const diagnosticParentIds = new Set(diagnosticSettings.map((item) => parentIdFromDiagnosticId(item.id)));
    result.details.resources = resources;
    result.details.diagnosticSettings = diagnosticSettings;
    result.details.resourcesWithoutDiagnostics = resources.filter((item) => !diagnosticParentIds.has(lower(item.id)));
    result.summary.totalCriticalResources = resources.length;
    result.summary.resourcesWithoutDiagnosticsCount = result.details.resourcesWithoutDiagnostics.length;
    result.summary.resourcesWithDiagnosticsCount = Math.max(resources.length - result.details.resourcesWithoutDiagnostics.length, 0);
  } catch (error) {
    result.details.partialErrors.push({ scope: 'ResourceGraph/resources', message: error.message });
  }

  result.summary.partialErrorsCount = result.details.partialErrors.length;
  const coverage = result.summary.totalCriticalResources > 0
    ? (result.summary.resourcesWithDiagnosticsCount / result.summary.totalCriticalResources) * 100
    : null;

  if (result.summary.resourcesWithoutDiagnosticsCount > 0) {
    result.checks.push({
      checkId: 'CHECK-AZ-DIAG-001',
      area: 'Logging & Monitoring',
      resourceType: 'Multiple Azure resource types',
      status: 'FAILED',
      severity: 'HIGH',
      title: 'Critical Azure resources are missing diagnostic settings',
      description: 'One or more critical resources do not expose diagnostic settings through Resource Graph. Without diagnostic routing, incident investigation and audit trails are weakened.',
      recommendation: 'Configure Azure Monitor diagnostic settings on critical resources and route logs to Log Analytics, Event Hub, or a controlled Storage archive.',
      affectedResourcesCount: result.summary.resourcesWithoutDiagnosticsCount,
      affectedResourcesSample: result.details.resourcesWithoutDiagnostics.slice(0, 10)
    });
  } else {
    result.checks.push({
      checkId: 'CHECK-AZ-DIAG-001',
      area: 'Logging & Monitoring',
      resourceType: 'Multiple Azure resource types',
      status: 'PASSED',
      severity: 'INFO',
      title: 'Diagnostic settings coverage is complete for discovered critical resources',
      description: 'No critical resource without diagnostic settings was found through Resource Graph.',
      recommendation: 'Keep diagnostic settings mandatory in IaC policies and monitor drift.',
      affectedResourcesCount: 0,
      affectedResourcesSample: []
    });
  }

  result.kpis = [
    coverageKpi({
      kpiId: 'DIAGNOSTIC_SETTINGS_COVERAGE',
      label: '% de ressources critiques avec journalisation activée',
      domain: 'logging',
      compliant: result.summary.resourcesWithDiagnosticsCount,
      total: result.summary.totalCriticalResources,
      warningBelow: 90,
      criticalBelow: 70,
      evidenceSource: 'azure_infrastructure.modules.diagnostic_coverage.summary',
      recommendation: 'Atteindre une couverture de diagnostic settings proche de 100% pour les ressources critiques.'
    }),
    riskCountKpi({
      kpiId: 'DIAGNOSTIC_SETTINGS_MISSING_COUNT',
      label: 'Ressources critiques sans diagnostic settings',
      domain: 'logging',
      count: result.summary.resourcesWithoutDiagnosticsCount,
      warningAt: 1,
      criticalAt: 10,
      evidenceSource: 'azure_infrastructure.modules.diagnostic_coverage.details.resourcesWithoutDiagnostics'
    })
  ];

  result.coverage = { valuePct: coverage === null ? null : Math.round(coverage * 100) / 100 };
  result.evidenceMetadata = buildModuleEvidenceMetadata(MODULE_NAME, result, CRITICAL_TYPES);
  result.status = result.summary.partialErrorsCount > 0 && result.summary.totalCriticalResources === 0 ? 'FAILED' : 'SUCCESS';
  result.duration_ms = Date.now() - startTime;
  return result;
}

module.exports = { auditDiagnosticCoverage, CRITICAL_TYPES };
