'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  shouldDisableCaching,
  headersForRequest
} = require('../../src/lib/http-security-policy');
const {
  ONBOARDING_RESULT_STYLE,
  ONBOARDING_RESULT_SCRIPT,
  ONBOARDING_RESULT_CSP,
  ONBOARDING_RESULT_STYLE_HASH,
  ONBOARDING_RESULT_SCRIPT_HASH
} = require('../../src/lib/onboarding-result-assets');

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

test('onboarding result page pins its local style and script with CSP hashes', () => {
  const headers = headersForRequest({
    url: '/v1/onboarding/azure/result',
    requestId: 'request-87654321',
    production: true
  });
  assert.equal(headers['Content-Security-Policy'], ONBOARDING_RESULT_CSP);
  assert.match(headers['Content-Security-Policy'], new RegExp(ONBOARDING_RESULT_STYLE_HASH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(headers['Content-Security-Policy'], new RegExp(ONBOARDING_RESULT_SCRIPT_HASH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(headers['Content-Security-Policy'], /unsafe-inline|unsafe-eval/);
  assert.match(headers['Content-Security-Policy'], /connect-src 'none'/);
});

test('other API routes keep the default no-script CSP', () => {
  const headers = headersForRequest({
    url: '/v1/scans/11111111-1111-4111-8111-111111111111/pdf',
    requestId: 'request-11223344',
    production: false
  });
  assert.equal(
    headers['Content-Security-Policy'],
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
});


test('onboarding CSP hashes are recomputed from the exact rendered asset bytes', () => {
  const hash = (value) => `'sha256-${createHash('sha256').update(value, 'utf8').digest('base64')}'`;
  assert.equal(ONBOARDING_RESULT_STYLE_HASH, hash(ONBOARDING_RESULT_STYLE));
  assert.equal(ONBOARDING_RESULT_SCRIPT_HASH, hash(ONBOARDING_RESULT_SCRIPT));
  const directives = ONBOARDING_RESULT_CSP.split('; ').map((entry) => entry.split(' '));
  const csp = Object.fromEntries(directives.map(([key, ...values]) => [key, values]));
  assert.deepEqual(csp['style-src'], [hash(ONBOARDING_RESULT_STYLE)]);
  assert.deepEqual(csp['script-src'], [hash(ONBOARDING_RESULT_SCRIPT)]);
  assert.deepEqual(csp['connect-src'], ["'none'"]);
  assert.deepEqual(csp['base-uri'], ["'none'"]);
  assert.deepEqual(csp['form-action'], ["'none'"]);
});
