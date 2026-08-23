'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { processScanMessage } = require('../src/services/message-processor');
const { assertProviderRuntimeEnabled } = require('../src/providers/provider-registry');

function logger() {
  return { info() {}, warn() {}, error() {} };
}

function config() {
  return {
    workerName: 'provider-boundary-test',
    serviceBus: { maxDeliveryCount: 5 },
    planResourceLimits: {},
    maxResultBytes: 1024 * 1024,
    resultCompressionThresholdBytes: 512 * 1024,
    globalScanTimeoutSeconds: 30,
    moduleTimeoutsMs: { resourcePreflight: 1000 },
    networkGuard: {}
  };
}

function completeDependencies(overrides = {}) {
  return {
    validateScanRequestedMessage: () => ({ valid: true }),
    assertProviderRuntimeEnabled,
    beginAttempt: async () => ({ acquired: true }),
    buildCrossTenantCredential: () => null,
    hasInfraModules: () => false,
    countAzureResources: async () => ({ total: 0, bySubscription: [] }),
    withTimeout: async (_label, _timeout, fn) => fn({ signal: new AbortController().signal }),
    runAudit: async () => ({ ok: true }),
    markResourcePreflight: async () => true,
    markCompleted: async () => true,
    markRetryable: async () => true,
    markFailed: async () => true,
    markRejectedMessage: async () => true,
    ...overrides
  };
}

function receiverRecorder() {
  const calls = [];
  return {
    calls,
    async deadLetterMessage(_message, properties) { calls.push(['deadLetter', properties]); },
    async completeMessage() { calls.push(['complete']); },
    async abandonMessage() { calls.push(['abandon']); }
  };
}

test('worker acquires, persists and dead-letters a declared but disabled AWS provider', async () => {
  const receiver = receiverRecorder();
  const persistence = [];

  await processScanMessage({
    message: {
      messageId: 'aws-disabled-1',
      deliveryCount: 1,
      body: {
        scanId: '31111111-1111-4111-8111-111111111111',
        tenantId: '11111111-1111-4111-8111-111111111111',
        cloudProvider: 'aws',
        modules: [],
        azure: {}
      }
    },
    receiver,
    config: config(),
    logger: logger(),
    pg: {},
    dependencies: completeDependencies({
      markFailed: async (_pg, payload) => {
        persistence.push(payload);
        return true;
      }
    })
  });

  assert.equal(persistence.length, 1);
  assert.equal(persistence[0].errorCode, 'PROVIDER_NOT_RUNTIME_ENABLED');
  assert.equal(persistence[0].attemptStatus, 'DEAD_LETTERED');
  assert.equal(receiver.calls.length, 1);
  assert.equal(receiver.calls[0][0], 'deadLetter');
  assert.equal(receiver.calls[0][1].deadLetterReason, 'PROVIDER_NOT_RUNTIME_ENABLED');
});

test('disabled provider is abandoned if its terminal state cannot be persisted', async () => {
  const receiver = receiverRecorder();

  await processScanMessage({
    message: {
      messageId: 'aws-disabled-2',
      deliveryCount: 1,
      body: {
        scanId: '31111111-1111-4111-8111-111111111111',
        tenantId: '11111111-1111-4111-8111-111111111111',
        cloudProvider: 'aws',
        modules: [],
        azure: {}
      }
    },
    receiver,
    config: config(),
    logger: logger(),
    pg: {},
    dependencies: completeDependencies({
      markFailed: async () => {
        throw new Error('database unavailable');
      }
    })
  });

  assert.deepEqual(receiver.calls, [['abandon']]);
});

test('worker accepts Azure and reaches the idempotent attempt boundary', async () => {
  const receiver = receiverRecorder();

  await processScanMessage({
    message: {
      messageId: 'message-1',
      deliveryCount: 1,
      body: {
        scanId: '31111111-1111-4111-8111-111111111111',
        tenantId: '11111111-1111-4111-8111-111111111111',
        cloudProvider: 'azure',
        modules: [],
        azure: { subscriptions: [] }
      }
    },
    receiver,
    config: config(),
    logger: logger(),
    pg: {},
    dependencies: completeDependencies({
      beginAttempt: async () => ({
        acquired: false,
        reason: 'SCAN_NOT_ACQUIRABLE',
        current: { status: 'DONE' }
      })
    })
  });

  assert.deepEqual(receiver.calls, [['complete']]);
});
