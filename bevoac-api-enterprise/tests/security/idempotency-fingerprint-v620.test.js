'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRequestFingerprint,
  assertIdempotencyFingerprint,
  resolveIdempotency
} = require('../../src/services/scan-service');
const {
  IdempotencyConflictError
} = require('../../src/lib/errors');

const base = {
  cloudProvider: 'azure',
  scanProfile: 'infra',
  modules: ['storage', 'nsg'],
  azure: {
    targetUrl: null,
    microsoftTenantId: '11111111-1111-4111-8111-111111111111',
    subscriptions: [
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333'
    ]
  }
};

test('fingerprint is canonical across module and subscription ordering', () => {
  const first = buildRequestFingerprint(base);
  const second = buildRequestFingerprint({
    ...base,
    modules: [...base.modules].reverse(),
    azure: {
      ...base.azure,
      subscriptions: [...base.azure.subscriptions].reverse()
    }
  });

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, second);
});

test('same idempotency key with different request is rejected', () => {
  const first = buildRequestFingerprint(base);
  const second = buildRequestFingerprint({
    ...base,
    modules: ['storage']
  });

  assert.throws(
    () => assertIdempotencyFingerprint(first, second, 'idem-key'),
    (error) => {
      assert.ok(error instanceof IdempotencyConflictError);
      assert.equal(error.statusCode, 409);
      assert.equal(
        error.code,
        'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST'
      );
      return true;
    }
  );
});


test('client idempotency keys are bounded and fail closed', () => {
  assert.equal(resolveIdempotency('stable-key').key, 'stable-key');
  assert.throws(
    () => resolveIdempotency('x'.repeat(256)),
    /must not exceed 255/
  );
  assert.throws(
    () => resolveIdempotency('invalid key'),
    /whitespace or control/
  );
  assert.throws(
    () => resolveIdempotency('invalid\nkey'),
    /whitespace or control/
  );
});
