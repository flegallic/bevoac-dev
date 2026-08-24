'use strict';

const { runResourceGraphQueryDetailed } = require('../../src/lib/resource-graph');
const { recordResourceGraphResult } = require('../../src/lib/resource-graph-evidence');
const { coverageKpi, riskCountKpi, buildModuleEvidenceMetadata } = require('../../src/lib/kpi-engine');

const MODULE_NAME = 'policy_compliance';

async function auditPolicyCompliance(subscriptions, credential, options = {}) {
  const startTime = Date.now();
  const result = {
    status: 'PENDING',
    checks: [],
    details: { policyStates: [], nonCompliantStates: [], partialErrors: [] },
    summary: { totalPolicyStates: 0, compliantStatesCount: 0, nonCompliantStatesCount: 0, partialErrorsCount: 0 }
  };

  try {
    const query = `policyresources | where tolower(type) contains 'microsoft.policyinsights/policystates' | project id, subscriptionId, policyAssignmentId=tostring(properties.policyAssignmentId), policyDefinitionId=tostring(properties.policyDefinitionId), complianceState=tostring(properties.complianceState), resourceId=tostring(properties.resourceId), resourceType=tostring(properties.resourceType), policyAssignmentName=tostring(properties.policyAssignmentName)`;
    const queryResult = await runResourceGraphQueryDetailed(credential, subscriptions, query, { signal: options.signal });
    const rows = recordResourceGraphResult(result, 'policy-states', queryResult);
    result.details.policyStates = rows;
    result.details.nonCompliantStates = rows.filter((row) => String(row.complianceState || '').toLowerCase() === 'noncompliant');
  } catch (error) {
    result.details.partialErrors.push({ scope: 'ResourceGraph/policyresources', message: error.message });
  }

  result.summary.totalPolicyStates = result.details.policyStates.length;
  result.summary.nonCompliantStatesCount = result.details.nonCompliantStates.length;
  result.summary.compliantStatesCount = Math.max(result.summary.totalPolicyStates - result.summary.nonCompliantStatesCount, 0);
  result.summary.partialErrorsCount = result.details.partialErrors.length;

  if (result.summary.nonCompliantStatesCount > 0) {
    result.checks.push({
      checkId: 'CHECK-AZ-POLICY-001',
      area: 'Azure Policy Compliance',
      resourceType: 'Microsoft.PolicyInsights/policyStates',
      status: 'FAILED',
      severity: 'MEDIUM',
      title: 'Azure Policy reports non-compliant resource states',
      description: 'Azure Policy compliance states indicate that one or more resources are non-compliant with assigned initiatives or policies.',
      recommendation: 'Review non-compliant policy states, prioritize security benchmark failures, and remediate through IaC or Azure Policy remediation tasks.',
      affectedResourcesCount: result.summary.nonCompliantStatesCount,
      affectedResourcesSample: result.details.nonCompliantStates.slice(0, 10)
    });
  } else {
    result.checks.push({
      checkId: 'CHECK-AZ-POLICY-001',
      area: 'Azure Policy Compliance',
      resourceType: 'Microsoft.PolicyInsights/policyStates',
      status: result.summary.totalPolicyStates === 0 ? 'WARNING' : 'PASSED',
      severity: result.summary.totalPolicyStates === 0 ? 'LOW' : 'INFO',
      title: result.summary.totalPolicyStates === 0 ? 'No Azure Policy compliance states were returned' : 'No non-compliant Azure Policy states were found',
      description: result.summary.totalPolicyStates === 0 ? 'Resource Graph did not return policy compliance state data. This can happen when Policy Insights is not enabled or the identity lacks permissions.' : 'All returned policy states are compliant.',
      recommendation: 'Ensure Azure Policy initiatives are assigned and Policy Insights data is available for the scanned subscriptions.',
      affectedResourcesCount: 0,
      affectedResourcesSample: []
    });
  }

  result.kpis = [
    coverageKpi({
      kpiId: 'AZURE_POLICY_COMPLIANCE_RATE',
      label: '% états Azure Policy conformes',
      domain: 'governance',
      compliant: result.summary.compliantStatesCount,
      total: result.summary.totalPolicyStates,
      warningBelow: 90,
      criticalBelow: 70,
      evidenceSource: 'azure_infrastructure.modules.policy_compliance.summary',
      limitations: result.summary.totalPolicyStates === 0 ? ['Aucun état Azure Policy retourné par Resource Graph.'] : []
    }),
    riskCountKpi({
      kpiId: 'AZURE_POLICY_NONCOMPLIANT_STATES',
      label: 'États Azure Policy non conformes',
      domain: 'governance',
      count: result.summary.nonCompliantStatesCount,
      warningAt: 1,
      criticalAt: 100,
      evidenceSource: 'azure_infrastructure.modules.policy_compliance.details.nonCompliantStates'
    })
  ];

  result.evidenceMetadata = buildModuleEvidenceMetadata(MODULE_NAME, result, ['Microsoft.PolicyInsights/policyStates']);
  result.status = result.summary.partialErrorsCount > 0 && result.summary.totalPolicyStates === 0 ? 'FAILED' : 'SUCCESS';
  result.duration_ms = Date.now() - startTime;
  return result;
}

module.exports = { auditPolicyCompliance };
