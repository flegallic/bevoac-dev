'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  processScanMessage
} = require('../src/services/message-processor');
const {
  assertProviderRuntimeEnabled
} = require('../src/providers/provider-registry');

function logger() {
  return {
    info() {},
    warn() {},
    error() {}
  };
}

function config() {
  return {
    workerName: 'provider-boundary-test',
    planResourceLimits: {},
    maxResultBytes: 1024 * 1024,
    resultCompressionThresholdBytes: 512 * 1024,
    globalScanTimeoutSeconds: 30,
    moduleTimeoutsMs: { resourcePreflight: 1000 },
    networkGuard: {}
  };
}

test('worker dead-letters a declared but disabled AWS provider before DB access', async () => {
  const calls = [];
  const receiver = {
    async deadLetterMessage(_message, properties) {
      calls.push(['deadLetter', properties]);
    },
    async completeMessage() {
      calls.push(['complete']);
    },
    async abandonMessage() {
      calls.push(['abandon']);
    }
  };

  await processScanMessage({
    message: {
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
    pg: null,
    dependencies: {
      validateScanRequestedMessage: () => ({ valid: true }),
      assertProviderRuntimeEnabled,
      beginAttempt: async () => {
        throw new Error('beginAttempt must not be reached for a disabled provider');
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'deadLetter');
  assert.equal(
    calls[0][1].deadLetterReason,
    'PROVIDER_NOT_RUNTIME_ENABLED'
  );
});

test('worker accepts Azure and reaches the idempotent attempt boundary', async () => {
  const calls = [];
  const receiver = {
    async deadLetterMessage() {
      calls.push(['deadLetter']);
    },
    async completeMessage() {
      calls.push(['complete']);
    },
    async abandonMessage() {
      calls.push(['abandon']);
    }
  };

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
    dependencies: {
      validateScanRequestedMessage: () => ({ valid: true }),
      assertProviderRuntimeEnabled,
      beginAttempt: async () => ({
        acquired: false,
        current: { status: 'DONE' }
      })
    }
  });

  assert.deepEqual(calls, [['complete']]);
});
