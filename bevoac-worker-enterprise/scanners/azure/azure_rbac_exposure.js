'use strict';

const { runResourceGraphQuery } = require('../../src/lib/resource-graph');
const { coverageKpi, riskCountKpi, buildModuleEvidenceMetadata } = require('../../src/lib/kpi-engine');

const MODULE_NAME = 'azure_rbac_exposure';
const HIGH_PRIVILEGE_ROLE_IDS = {
  owner: '8e3af657-a8ff-443c-a75c-2fe8c4bcb635b',
  contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c',
  userAccessAdministrator: 'f1a07417-d97a-45cb-824c-7a7467783830'
};

function normalizeRoleDefinitionId(value) {
  return String(value || '').split('/').pop().toLowerCase();
}

function isSubscriptionScope(scope) {
  const normalized = String(scope || '').toLowerCase();
  return /^\/subscriptions\/[^/]+$/.test(normalized);
}

function classifyRole(roleDefinitionId) {
  const id = normalizeRoleDefinitionId(roleDefinitionId);
  if (id === HIGH_PRIVILEGE_ROLE_IDS.owner) return 'Owner';
  if (id === HIGH_PRIVILEGE_ROLE_IDS.contributor) return 'Contributor';
  if (id === HIGH_PRIVILEGE_ROLE_IDS.userAccessAdministrator) return 'User Access Administrator';
  return null;
}

async function auditAzureRbacExposure(subscriptions, credential) {
  const startTime = Date.now();
  const result = {
    status: 'PENDING',
    checks: [],
    details: { roleAssignments: [], highPrivilegeAssignments: [], broadScopeAssignments: [], externalOrUnknownPrincipals: [], partialErrors: [] },
    summary: { totalRoleAssignments: 0, highPrivilegeAssignmentsCount: 0, broadScopeAssignmentsCount: 0, externalOrUnknownPrincipalsCount: 0, partialErrorsCount: 0 }
  };

  try {
    const query = `authorizationresources | where tolower(type) == 'microsoft.authorization/roleassignments' | project id, name, type, subscriptionId, roleDefinitionId=tostring(properties.roleDefinitionId), principalId=tostring(properties.principalId), principalType=tostring(properties.principalType), scope=tostring(properties.scope)`;
    const rows = await runResourceGraphQuery(credential, subscriptions, query);
    result.details.roleAssignments = rows;
    for (const row of rows) {
      const roleName = classifyRole(row.roleDefinitionId);
      if (roleName) {
        const evidence = { ...row, roleName };
        result.details.highPrivilegeAssignments.push(evidence);
        if (isSubscriptionScope(row.scope)) result.details.broadScopeAssignments.push(evidence);
        if (!row.principalType || String(row.principalType).toLowerCase() === 'unknown') result.details.externalOrUnknownPrincipals.push(evidence);
      }
    }
  } catch (error) {
    result.details.partialErrors.push({ scope: 'ResourceGraph/authorizationresources', message: error.message });
  }

  result.summary.totalRoleAssignments = result.details.roleAssignments.length;
  result.summary.highPrivilegeAssignmentsCount = result.details.highPrivilegeAssignments.length;
  result.summary.broadScopeAssignmentsCount = result.details.broadScopeAssignments.length;
  result.summary.externalOrUnknownPrincipalsCount = result.details.externalOrUnknownPrincipals.length;
  result.summary.partialErrorsCount = result.details.partialErrors.length;

  if (result.summary.broadScopeAssignmentsCount > 0) {
    result.checks.push({
      checkId: 'CHECK-AZ-RBAC-001',
      area: 'Azure RBAC',
      resourceType: 'Microsoft.Authorization/roleAssignments',
      status: 'FAILED',
      severity: 'HIGH',
      title: 'High-privilege Azure RBAC assignments exist at subscription scope',
      description: 'Owner, Contributor or User Access Administrator roles were found at broad subscription scope. These assignments can grant excessive access across many resources.',
      recommendation: 'Reduce broad-scope assignments, prefer least-privilege custom roles, resource-group scope, and time-bound Privileged Identity Management where available.',
      affectedResourcesCount: result.summary.broadScopeAssignmentsCount,
      affectedResourcesSample: result.details.broadScopeAssignments.slice(0, 10)
    });
  } else {
    result.checks.push({
      checkId: 'CHECK-AZ-RBAC-001',
      area: 'Azure RBAC',
      resourceType: 'Microsoft.Authorization/roleAssignments',
      status: 'PASSED',
      severity: 'INFO',
      title: 'No high-privilege role assignment at broad subscription scope was found',
      description: 'The scan did not detect Owner, Contributor or User Access Administrator assignments at subscription root scope.',
      recommendation: 'Continue enforcing least privilege and periodically review privileged assignments.',
      affectedResourcesCount: 0,
      affectedResourcesSample: []
    });
  }

  result.kpis = [
    coverageKpi({
      kpiId: 'AZURE_RBAC_NON_PRIVILEGED_ASSIGNMENT_RATE',
      label: '% affectations RBAC non hautement privilégiées',
      domain: 'azure_iam',
      compliant: Math.max(result.summary.totalRoleAssignments - result.summary.highPrivilegeAssignmentsCount, 0),
      total: result.summary.totalRoleAssignments,
      warningBelow: 90,
      criticalBelow: 70,
      evidenceSource: 'azure_infrastructure.modules.azure_rbac_exposure.summary.highPrivilegeAssignmentsCount'
    }),
    riskCountKpi({
      kpiId: 'AZURE_RBAC_BROAD_PRIVILEGED_ASSIGNMENTS',
      label: 'Affectations RBAC hautement privilégiées au scope subscription',
      domain: 'azure_iam',
      count: result.summary.broadScopeAssignmentsCount,
      warningAt: 1,
      criticalAt: 5,
      evidenceSource: 'azure_infrastructure.modules.azure_rbac_exposure.details.broadScopeAssignments'
    })
  ];

  result.evidenceMetadata = buildModuleEvidenceMetadata(MODULE_NAME, result, ['Microsoft.Authorization/roleAssignments']);
  result.status = result.summary.partialErrorsCount > 0 && result.summary.totalRoleAssignments === 0 ? 'FAILED' : 'SUCCESS';
  result.duration_ms = Date.now() - startTime;
  return result;
}

module.exports = { auditAzureRbacExposure, classifyRole, HIGH_PRIVILEGE_ROLE_IDS };
