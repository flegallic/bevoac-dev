'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResultSummary, collectFindings } = require('../src/lib/findings-collector');
const { normalizeScopes, hasScope } = require('../src/lib/api-scopes');

test('findings collector recursively counts nested module findings', () => {
  const result = {
    webSecurity: { findings: [{ severity: 'HIGH', status: 'OPEN', title: 'TLS' }] },
    azure_infrastructure: {
      modules: {
        storage: { findings: [{ severity: 'CRITICAL', status: 'OPEN', title: 'Public blob' }] },
        nsg: { nested: { findings: [{ severity: 'medium', status: 'accepted', title: 'Wide rule' }] } }
      }
    }
  };
  const findings = collectFindings(result);
  const summary = buildResultSummary(result);
  assert.equal(findings.length, 3);
  assert.equal(summary.findingCount, 3);
  assert.equal(summary.bySeverity.CRITICAL, 1);
  assert.equal(summary.bySeverity.HIGH, 1);
  assert.equal(summary.bySeverity.MEDIUM, 1);
});

test('api scopes support exact and wildcard scopes', () => {
  const scopes = normalizeScopes(['scan:*', 'billing:read']);
  assert.equal(hasScope(scopes, 'scan:create'), true);
  assert.equal(hasScope(scopes, 'scan:result:read'), true);
  assert.equal(hasScope(scopes, 'billing:read'), true);
  assert.equal(hasScope(scopes, 'onboarding:write'), false);
});
