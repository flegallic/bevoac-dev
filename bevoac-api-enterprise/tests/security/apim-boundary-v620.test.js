'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizedPath,
  isBoundaryExempt
} = require('../../src/lib/apim-boundary');
const { secureCompare } = require('../../src/lib/security');

test('APIM boundary exempt paths are minimal and ignore query strings', () => {
  assert.equal(normalizedPath('/v1/health/ready?probe=1'), '/v1/health/ready');
  assert.equal(isBoundaryExempt('/v1/health/ready?probe=1'), true);
  assert.equal(isBoundaryExempt('/v1/onboarding/azure/callback?state=opaque'), true);
  assert.equal(isBoundaryExempt('/v1/onboarding/azure/result#ignored'), false);
  assert.equal(isBoundaryExempt('/v1/onboarding/azure/result'), true);
  assert.equal(isBoundaryExempt('/v1/scans'), false);
  assert.equal(isBoundaryExempt('/v1/admin/billing'), false);
});

test('backend token comparison is exact and timing safe at the helper boundary', () => {
  assert.equal(secureCompare('expected-token', 'expected-token'), true);
  assert.equal(secureCompare('wrong-token', 'expected-token'), false);
  assert.equal(secureCompare('', 'expected-token'), false);
});
