'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldDisableCaching,
  headersForRequest
} = require('../../src/lib/http-security-policy');

test('customer scan and onboarding responses are explicitly non-cacheable', () => {
  assert.equal(shouldDisableCaching('/v1/scans/123/result'), true);
  assert.equal(shouldDisableCaching('/v1/onboarding/azure/status?x=1'), true);
  assert.equal(shouldDisableCaching('/v1/health/live'), false);
});

test('production security policy emits no-store and HSTS', () => {
  const headers = headersForRequest({
    url: '/v1/scans/11111111-1111-4111-8111-111111111111/pdf',
    requestId: 'request-12345678',
    production: true
  });
  assert.match(headers['Cache-Control'], /no-store/);
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.match(headers['Strict-Transport-Security'], /max-age=31536000/);
  assert.equal(headers['X-Correlation-ID'], 'request-12345678');
});
