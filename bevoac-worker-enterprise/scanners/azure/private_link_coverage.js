'use strict';

const { runResourceGraphQueryDetailed } = require('../../src/lib/resource-graph');
const { recordResourceGraphResult } = require('../../src/lib/resource-graph-evidence');
const { coverageKpi, riskCountKpi, buildModuleEvidenceMetadata } = require('../../src/lib/kpi-engine');

const MODULE_NAME = 'private_link_coverage';
const RESOURCE_TYPES = [
  'microsoft.keyvault/vaults',
  'microsoft.storage/storageaccounts',
  'microsoft.sql/servers',
  'microsoft.dbforpostgresql/flexibleservers',
  'microsoft.web/sites'
];

function approvedPrivateEndpointsCount(properties) {
  const connections = Array.isArray(properties?.privateEndpointConnections) ? properties.privateEndpointConnections : [];
  return connections.filter((connection) => {
    const status = connection?.properties?.privateLinkServiceConnectionState?.status || connection?.privateLinkServiceConnectionState?.status;
    return String(status || '').toLowerCase() === 'approved';
  }).length;
}

async function auditPrivateLinkCoverage(subscriptions, credential, options = {}) {
  const startTime = Date.now();
  const result = {
    status: 'PENDING',
    checks: [],
    details: { resources: [], withoutPrivateLink: [], partialErrors: [] },
    summary: { totalEligibleResources: 0, resourcesWithPrivateLinkCount: 0, resourcesWithoutPrivateLinkCount: 0, partialErrorsCount: 0 }
  };
  try {
    const typeList = RESOURCE_TYPES.map((type) => `'${type}'`).join(', ');
    const query = `resources | where tolower(type) in (${typeList}) | project id, name, type, location, resourceGroup, subscriptionId, properties`;
    const queryResult = await runResourceGraphQueryDetailed(credential, subscriptions, query, { signal: options.signal });
    const rows = recordResourceGraphResult(result, 'private-link-resources', queryResult);
    result.details.resources = rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      location: row.location,
      resourceGroup: row.resourceGroup,
      subscriptionId: row.subscriptionId,
      approvedPrivateEndpointsCount: approvedPrivateEndpointsCount(row.properties)
    }));
    result.details.withoutPrivateLink = result.details.resources.filter((item) => item.approvedPrivateEndpointsCount < 1);
  } catch (error) {
    result.details.partialErrors.push({ scope: 'ResourceGraph/privateLinkCoverage', message: error.message });
  }

  result.summary.totalEligibleResources = result.details.resources.length;
  result.summary.resourcesWithoutPrivateLinkCount = result.details.withoutPrivateLink.length;
  result.summary.resourcesWithPrivateLinkCount = Math.max(result.summary.totalEligibleResources - result.summary.resourcesWithoutPrivateLinkCount, 0);
  result.summary.partialErrorsCount = result.details.partialErrors.length;

  if (result.summary.resourcesWithoutPrivateLinkCount > 0) {
    result.checks.push({
      checkId: 'CHECK-AZ-PL-001',
      area: 'Private Networking',
      resourceType: 'Multiple PaaS resources',
      status: 'WARNING',
      severity: 'MEDIUM',
      title: 'PaaS resources without approved Private Endpoint coverage',
      description: 'One or more eligible PaaS resources do not expose an approved private endpoint connection in Resource Graph.',
      recommendation: 'Use Azure Private Link for sensitive PaaS resources and restrict public network access where possible.',
      affectedResourcesCount: result.summary.resourcesWithoutPrivateLinkCount,
      affectedResourcesSample: result.details.withoutPrivateLink.slice(0, 10)
    });
  } else {
    result.checks.push({
      checkId: 'CHECK-AZ-PL-001',
      area: 'Private Networking',
      resourceType: 'Multiple PaaS resources',
      status: 'PASSED',
      severity: 'INFO',
      title: 'Private Endpoint coverage is complete for eligible discovered resources',
      description: 'Every eligible discovered resource exposes at least one approved private endpoint connection.',
      recommendation: 'Maintain Private Link as the default connectivity pattern for sensitive PaaS services.',
      affectedResourcesCount: 0,
      affectedResourcesSample: []
    });
  }

  result.kpis = [
    coverageKpi({
      kpiId: 'PRIVATE_LINK_COVERAGE',
      label: '% ressources PaaS éligibles avec Private Endpoint approuvé',
      domain: 'private_networking',
      compliant: result.summary.resourcesWithPrivateLinkCount,
      total: result.summary.totalEligibleResources,
      warningBelow: 80,
      criticalBelow: 50,
      evidenceSource: 'azure_infrastructure.modules.private_link_coverage.summary'
    }),
    riskCountKpi({
      kpiId: 'PRIVATE_LINK_MISSING_COUNT',
      label: 'Ressources PaaS éligibles sans Private Endpoint',
      domain: 'private_networking',
      count: result.summary.resourcesWithoutPrivateLinkCount,
      warningAt: 1,
      criticalAt: 10,
      evidenceSource: 'azure_infrastructure.modules.private_link_coverage.details.withoutPrivateLink'
    })
  ];

  result.evidenceMetadata = buildModuleEvidenceMetadata(MODULE_NAME, result, RESOURCE_TYPES);
  result.status = result.summary.partialErrorsCount > 0 && result.summary.totalEligibleResources === 0 ? 'FAILED' : 'SUCCESS';
  result.duration_ms = Date.now() - startTime;
  return result;
}

module.exports = { auditPrivateLinkCoverage, approvedPrivateEndpointsCount };
