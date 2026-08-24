'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeExecutionStatus,
  computeSecurityPosture,
  decorateModuleStatus
} = require('../src/lib/status-semantics');

test('RBAC pagination truncation is PARTIAL when role assignments were analyzed', () => {
  const result = {
    status: 'WARNING',
    summary: { totalRoleAssignments: 1500 },
    details: {
      partialErrors: [{ code: 'RESOURCE_GRAPH_TRUNCATED', message: 'max pages reached' }]
    },
    checks: []
  };
  assert.equal(computeExecutionStatus(result), 'PARTIAL');
  assert.equal(computeSecurityPosture(result), 'WARN');
});

test('private-link pagination truncation is PARTIAL when eligible resources were analyzed', () => {
  const decorated = decorateModuleStatus({
    status: 'PARTIAL',
    summary: { totalEligibleResources: 1200 },
    details: {
      partialErrors: [{ code: 'RESOURCE_GRAPH_TRUNCATED' }]
    }
  });
  assert.equal(decorated.executionStatus, 'PARTIAL');
  assert.equal(decorated.securityPosture, 'WARN');
});

test('partial error with no analyzed resource remains FAILED', () => {
  const result = {
    status: 'FAILED',
    summary: { totalEligibleResources: 0 },
    details: { partialErrors: [{ code: 'QUERY_FAILED' }] }
  };
  assert.equal(computeExecutionStatus(result), 'FAILED');
  assert.equal(computeSecurityPosture(result), 'FAIL');
});
