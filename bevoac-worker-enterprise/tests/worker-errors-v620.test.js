'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyWorkerError,
  publicFailurePayload,
  redactString
} = require('../src/lib/worker-errors');

test('429 and 503 failures are retryable', () => {
  assert.equal(classifyWorkerError({ statusCode: 429 }).retryable, true);
  assert.equal(classifyWorkerError({ statusCode: 503 }).retryable, true);
});

test('403 is terminal and exposes only a safe public message', () => {
  const error = new Error('Bearer secret-token https://sensitive.example/path');
  error.statusCode = 403;
  const classified = classifyWorkerError(error);
  const payload = publicFailurePayload(classified, 'correlation');
  assert.equal(classified.retryable, false);
  assert.equal(payload.code, 'PROVIDER_PERMISSION_DENIED');
  assert.doesNotMatch(payload.message, /secret-token|sensitive/);
});

test('redaction removes URLs and secret-like values', () => {
  const output = redactString('token=abc https://example.test/x');
  assert.doesNotMatch(output, /abc|example\.test/);
});
