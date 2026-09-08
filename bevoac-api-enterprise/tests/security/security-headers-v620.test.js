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
  ONBOARDING_RESULT_SCRIPT_HASH,
  ONBOARDING_LANDING_STYLE,
  ONBOARDING_LANDING_SCRIPT,
  ONBOARDING_LANDING_CSP,
  ONBOARDING_LANDING_STYLE_HASH,
  ONBOARDING_LANDING_SCRIPT_HASH
} = require('../../src/lib/onboarding-result-assets');

test('customer scan and onboarding responses are explicitly non-cacheable', () => {
  assert.equal(shouldDisableCaching('/v1/scans/123/result'), true);
  assert.equal(shouldDisableCaching('/v1/onboarding/azure'), true);
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

test('onboarding result page pins its local style and script and cannot call the network', () => {
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

test('onboarding landing page pins its local style and script and permits same-origin bootstrap only', () => {
  const headers = headersForRequest({
    url: '/v1/onboarding/azure',
    requestId: 'request-landing-1234',
    production: true
  });
  assert.equal(headers['Content-Security-Policy'], ONBOARDING_LANDING_CSP);
  assert.match(headers['Content-Security-Policy'], new RegExp(ONBOARDING_LANDING_STYLE_HASH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(headers['Content-Security-Policy'], new RegExp(ONBOARDING_LANDING_SCRIPT_HASH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(headers['Content-Security-Policy'], /unsafe-inline|unsafe-eval/);
  assert.match(headers['Content-Security-Policy'], /connect-src 'self'/);
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
  assert.equal(ONBOARDING_LANDING_STYLE_HASH, hash(ONBOARDING_LANDING_STYLE));
  assert.equal(ONBOARDING_LANDING_SCRIPT_HASH, hash(ONBOARDING_LANDING_SCRIPT));

  const resultDirectives = ONBOARDING_RESULT_CSP.split('; ').map((entry) => entry.split(' '));
  const resultCsp = Object.fromEntries(resultDirectives.map(([key, ...values]) => [key, values]));
  assert.deepEqual(resultCsp['style-src'], [hash(ONBOARDING_RESULT_STYLE)]);
  assert.deepEqual(resultCsp['script-src'], [hash(ONBOARDING_RESULT_SCRIPT)]);
  assert.deepEqual(resultCsp['connect-src'], ["'none'"]);

  const landingDirectives = ONBOARDING_LANDING_CSP.split('; ').map((entry) => entry.split(' '));
  const landingCsp = Object.fromEntries(landingDirectives.map(([key, ...values]) => [key, values]));
  assert.deepEqual(landingCsp['style-src'], [hash(ONBOARDING_LANDING_STYLE)]);
  assert.deepEqual(landingCsp['script-src'], [hash(ONBOARDING_LANDING_SCRIPT)]);
  assert.deepEqual(landingCsp['connect-src'], ["'self'"]);
  assert.deepEqual(landingCsp['base-uri'], ["'none'"]);
  assert.deepEqual(landingCsp['form-action'], ["'none'"]);
});
