'use strict';

const { runResourceGraphQueryDetailed } = require('../../src/lib/resource-graph');
const { recordResourceGraphResult } = require('../../src/lib/resource-graph-evidence');
const { coverageKpi, riskCountKpi, buildModuleEvidenceMetadata } = require('../../src/lib/kpi-engine');

const MODULE_NAME = 'encryption_coverage';
const RESOURCE_TYPES = [
  'microsoft.storage/storageaccounts',
  'microsoft.compute/disks',
  'microsoft.sql/servers',
  'microsoft.dbforpostgresql/flexibleservers',
  'microsoft.keyvault/vaults'
];

function typeOf(row) { return String(row?.type || '').toLowerCase(); }
function getProps(row) { return row?.properties || row?.props || {}; }

function evaluateEncryption(row) {
  const type = typeOf(row);
  const props = getProps(row);
  if (type === 'microsoft.storage/storageaccounts') {
    const encryption = props.encryption || {};
    const services = encryption.services || {};
    const blobEnabled = services.blob?.enabled !== false;
    const fileEnabled = services.file?.enabled !== false;
    return { supported: true, compliant: blobEnabled && fileEnabled, reason: blobEnabled && fileEnabled ? 'storage encryption enabled' : 'storage encryption service disabled' };
  }
  if (type === 'microsoft.compute/disks') {
    const encryption = props.encryption || {};
    const encryptionSettings = props.encryptionSettingsCollection || props.encryptionSettings;
    const compliant = encryption.type || encryption.diskEncryptionSetId || encryptionSettings?.enabled !== false;
    return { supported: true, compliant: Boolean(compliant), reason: compliant ? 'disk encryption signal present' : 'no explicit disk encryption signal' };
  }
  if (type === 'microsoft.sql/servers') {
    return { supported: false, compliant: null, reason: 'SQL TDE is exposed through database-level resources; use future data-plane/Policy enrichment for strict proof.' };
  }
  if (type === 'microsoft.dbforpostgresql/flexibleservers') {
    const dataEncryption = props.dataEncryption || props.dataEncryptionStatus || props.dataEncryptionEnabled;
    return { supported: true, compliant: dataEncryption ? true : null, reason: dataEncryption ? 'PostgreSQL data encryption signal present' : 'encryption state unknown in Resource Graph properties' };
  }
  if (type === 'microsoft.keyvault/vaults') {
    return { supported: true, compliant: true, reason: 'Key Vault managed service with platform encryption; access controls are audited separately.' };
  }
  return { supported: false, compliant: null, reason: 'unsupported resource type' };
}

async function auditEncryptionCoverage(subscriptions, credential, options = {}) {
  const startTime = Date.now();
  const result = {
    status: 'PENDING',
    checks: [],
    details: { resources: [], nonCompliant: [], unknown: [], partialErrors: [] },
    summary: { totalResources: 0, supportedResources: 0, encryptedResourcesCount: 0, nonCompliantResourcesCount: 0, unknownEncryptionStateCount: 0, partialErrorsCount: 0 }
  };
  try {
    const typeList = RESOURCE_TYPES.map((type) => `'${type}'`).join(', ');
    const query = `resources | where tolower(type) in (${typeList}) | project id, name, type, location, resourceGroup, subscriptionId, properties`;
    const queryResult = await runResourceGraphQueryDetailed(credential, subscriptions, query, { signal: options.signal });
    const rows = recordResourceGraphResult(result, 'encryption-resources', queryResult);
    result.details.resources = rows.map((row) => ({ id: row.id, name: row.name, type: row.type, location: row.location, resourceGroup: row.resourceGroup, subscriptionId: row.subscriptionId, evaluation: evaluateEncryption(row) }));

    for (const resource of result.details.resources) {
      const evaluation = resource.evaluation;
      if (!evaluation.supported) continue;
      result.summary.supportedResources += 1;
      if (evaluation.compliant === true) result.summary.encryptedResourcesCount += 1;
      else if (evaluation.compliant === false) result.details.nonCompliant.push(resource);
      else result.details.unknown.push(resource);
    }
    result.summary.totalResources = rows.length;
    result.summary.nonCompliantResourcesCount = result.details.nonCompliant.length;
    result.summary.unknownEncryptionStateCount = result.details.unknown.length;
  } catch (error) {
    result.details.partialErrors.push({ scope: 'ResourceGraph/encryption', message: error.message });
  }

  result.summary.partialErrorsCount = result.details.partialErrors.length;
  if (result.summary.nonCompliantResourcesCount > 0) {
    result.checks.push({
      checkId: 'CHECK-AZ-ENC-001',
      area: 'Encryption at Rest',
      resourceType: 'Multiple Azure resource types',
      status: 'FAILED',
      severity: 'HIGH',
      title: 'Resources with missing or disabled encryption-at-rest signals were found',
      description: 'Some resources expose explicit evidence that encryption-at-rest is missing or disabled. Unknown states are tracked separately and should be reviewed before making compliance claims.',
      recommendation: 'Enable encryption-at-rest and customer-managed keys where required by the client baseline. Review unknown states through Azure Policy or service-specific APIs.',
      affectedResourcesCount: result.summary.nonCompliantResourcesCount,
      affectedResourcesSample: result.details.nonCompliant.slice(0, 10)
    });
  } else {
    result.checks.push({
      checkId: 'CHECK-AZ-ENC-001',
      area: 'Encryption at Rest',
      resourceType: 'Multiple Azure resource types',
      status: 'PASSED',
      severity: 'INFO',
      title: 'No explicit encryption-at-rest failure was found',
      description: 'No supported resource returned explicit evidence of disabled encryption-at-rest. Unknown states remain visible in the module summary.',
      recommendation: 'Use Azure Policy for mandatory encryption baselines and keep customer-managed keys where required.',
      affectedResourcesCount: 0,
      affectedResourcesSample: []
    });
  }

  result.kpis = [
    coverageKpi({
      kpiId: 'ENCRYPTION_AT_REST_KNOWN_COVERAGE',
      label: '% de ressources supportées avec signal de chiffrement au repos conforme',
      domain: 'encryption',
      compliant: result.summary.encryptedResourcesCount,
      total: result.summary.supportedResources,
      warningBelow: 95,
      criticalBelow: 85,
      evidenceSource: 'azure_infrastructure.modules.encryption_coverage.summary',
      limitations: result.summary.unknownEncryptionStateCount > 0 ? ['Certaines ressources ont un état de chiffrement inconnu via Resource Graph.'] : []
    }),
    riskCountKpi({
      kpiId: 'ENCRYPTION_UNKNOWN_STATE_COUNT',
      label: 'Ressources avec état de chiffrement inconnu',
      domain: 'encryption',
      count: result.summary.unknownEncryptionStateCount,
      warningAt: 1,
      criticalAt: 20,
      evidenceSource: 'azure_infrastructure.modules.encryption_coverage.details.unknown'
    })
  ];

  result.evidenceMetadata = buildModuleEvidenceMetadata(MODULE_NAME, result, RESOURCE_TYPES);
  result.status = result.summary.partialErrorsCount > 0 && result.summary.totalResources === 0 ? 'FAILED' : 'SUCCESS';
  result.duration_ms = Date.now() - startTime;
  return result;
}

module.exports = { auditEncryptionCoverage, evaluateEncryption };
