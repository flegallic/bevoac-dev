'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EMPTY_QUERY_SCHEMA,
  CALLBACK_QUERY_SCHEMA,
  ONBOARDING_RESULT_HTML
} = require('../../src/routes/onboarding-azure');

test('onboarding status rejects unexpected query parameters', () => {
  assert.equal(EMPTY_QUERY_SCHEMA.additionalProperties, false);
  assert.equal(EMPTY_QUERY_SCHEMA.maxProperties, 0);
});

test('Microsoft callback accepts only the documented, bounded parameter set', () => {
  assert.equal(CALLBACK_QUERY_SCHEMA.additionalProperties, false);
  assert.deepEqual(CALLBACK_QUERY_SCHEMA.required, ['state']);
  assert.equal(CALLBACK_QUERY_SCHEMA.properties.state.maxLength, 4096);
  assert.equal(CALLBACK_QUERY_SCHEMA.properties.tenant.format, 'uuid');
  assert.equal(CALLBACK_QUERY_SCHEMA.properties.error_description.maxLength, 1000);
  assert.ok(CALLBACK_QUERY_SCHEMA.properties.error_uri);
  assert.ok(CALLBACK_QUERY_SCHEMA.properties.trace_id);
  assert.ok(CALLBACK_QUERY_SCHEMA.properties.correlation_id);
});


test('credential-free onboarding result page contains no script or API-key input', () => {
  assert.match(ONBOARDING_RESULT_HTML, /No client credential is requested or stored/);
  assert.doesNotMatch(ONBOARDING_RESULT_HTML, /<script|apiKey|sessionStorage|localStorage/i);
});
