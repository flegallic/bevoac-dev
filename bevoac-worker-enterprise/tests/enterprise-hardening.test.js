'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResultSummary } = require('../src/lib/findings-collector');

test('worker summary counts nested cloud findings', () => {
  const summary = buildResultSummary({
    azure_infrastructure: {
      modules: {
        keyvault: { findings: [{ severity: 'HIGH', status: 'OPEN', title: 'KV public' }] },
        storage: { findings: [{ severity: 'LOW', status: 'OPEN', title: 'Blob logging' }] }
      }
    }
  });
  assert.equal(summary.findingCount, 2);
  assert.equal(summary.bySeverity.HIGH, 1);
  assert.equal(summary.bySeverity.LOW, 1);
});
