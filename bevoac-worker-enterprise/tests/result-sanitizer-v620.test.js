'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeCustomerResult,
  sanitizeString
} = require('../src/lib/result-sanitizer');
const { saveResult } = require('../src/services/scan-store');

test('customer result sanitizer removes secrets and URL query values', () => {
  const input = {
    error: 'request failed at https://example.test/path?token=abc&customer=42#fragment token=abc',
    authorization: 'Bearer super-secret',
    nested: {
      clientSecret: 'secret-value',
      resourceId: '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg'
    }
  };

  const output = sanitizeCustomerResult(input);
  assert.equal(output.authorization, '[REDACTED]');
  assert.equal(output.nested.clientSecret, '[REDACTED]');
  assert.match(output.error, /https:\/\/example\.test\/path/);
  assert.doesNotMatch(output.error, /customer=42|abc|fragment/);
  assert.match(output.nested.resourceId, /11111111-1111-4111-8111-111111111111/);
});

test('sanitizer removes stack and response internals', () => {
  const output = sanitizeCustomerResult({
    message: 'safe',
    stack: 'private stack',
    response: { headers: { authorization: 'secret' } }
  });
  assert.deepEqual(output, { message: 'safe' });
});

test('string sanitizer redacts credential-shaped fields', () => {
  const output = sanitizeString('password=my-pass https://host.test/a?sig=123');
  assert.doesNotMatch(output, /my-pass|123/);
  assert.match(output, /password=\[REDACTED\]/i);
});


test('scan result JSON and summary are built from the same sanitized object', async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text: String(text), values });
      return { rowCount: 1, rows: [] };
    }
  };

  await saveResult(client, {
    scanId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    result: {
      error: { message: 'token=super-secret', authorization: 'Bearer secret' },
      findings: []
    },
    maxResultBytes: 100000,
    compressionThresholdBytes: 100000
  });

  const insert = calls.find((call) => call.text.includes('INSERT INTO scan_results'));
  const storedJson = JSON.parse(insert.values[2]);
  const storedSummary = JSON.parse(insert.values[5]);
  assert.equal(storedJson.error.authorization, '[REDACTED]');
  assert.doesNotMatch(storedJson.error.message, /super-secret/);
  assert.equal(storedSummary.error.authorization, '[REDACTED]');
  assert.doesNotMatch(storedSummary.error.message, /super-secret/);
});
