'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSignedState,
  verifySignedState
} = require('../../src/lib/onboarding-state');
const { buildSuccessRedirect } = require('../../src/services/azure-onboarding-service');

const secret = '0123456789abcdef'.repeat(4);
const payload = {
  sid: '11111111-1111-4111-8111-111111111111',
  tid: '22222222-2222-4222-8222-222222222222',
  kid: '33333333-3333-4333-8333-333333333333',
  nonce: '44444444-4444-4444-8444-444444444444',
  exp: Date.now() + 60000
};

test('new onboarding state is authenticated and opaque', () => {
  const state = createSignedState(secret, payload);
  assert.match(state, /^v2\./);
  assert.doesNotMatch(state, /11111111|22222222/);
  assert.deepEqual(verifySignedState(secret, state), payload);
});

test('tampered onboarding state is rejected', () => {
  const state = createSignedState(secret, payload);
  const parts = state.split('.');
  const ciphertext = Buffer.from(parts[2], 'base64url');
  ciphertext[0] ^= 0x01;
  parts[2] = ciphertext.toString('base64url');
  assert.throws(() => verifySignedState(secret, parts.join('.')), /Invalid onboarding state/);
});


test('onboarding callback defaults to the credential-free API result page', () => {
  const target = buildSuccessRedirect(
    { onboarding: { frontendSuccessUrl: '' } },
    { status: 'success', reason: '', subscriptionCount: '2' }
  );
  assert.equal(
    target,
    '/v1/onboarding/azure/result#status=success&subscriptionCount=2'
  );
});
