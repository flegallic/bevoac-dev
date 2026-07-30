'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ADAPTER_VERSION,
  assertProviderAdapter,
  normalizedFinding
} = require('../../src/providers/provider-contract');

function completeAdapter() {
  return {
    version: ADAPTER_VERSION,
    validateCredentialReference() {},
    discoverScope() {},
    preflight() {},
    runModules() {},
    normalizeFindings() {}
  };
}

test('provider adapter contract accepts a complete adapter', () => {
  assert.equal(assertProviderAdapter(completeAdapter()).version, ADAPTER_VERSION);
});

test('provider adapter contract rejects incomplete adapters', () => {
  assert.throws(() => assertProviderAdapter({ version: ADAPTER_VERSION }), /missing/);
});

test('normalized finding is provider neutral', () => {
  const finding = normalizedFinding({
    provider: 'aws',
    controlId: 'AWS-IAM-001',
    status: 'FAILED',
    severity: 'HIGH'
  });
  assert.equal(finding.provider, 'aws');
});
