'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  processScanMessage,
  deliveryAttempt,
  retryExhausted,
  safeMessageIdentity,
  compactValidationErrors
} = require('../src/services/message-processor');
const {
  RetryableWorkerError,
  TerminalWorkerError
} = require('../src/lib/worker-errors');

const body = {
  version: 'test',
  scanId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  cloudProvider: 'azure',
  modules: ['web'],
  azure: { targetUrl: 'https://example.test', subscriptions: [] },
  limits: { resourceLimit: 10 }
};

function receiverRecorder() {
  const events = [];
  return {
    events,
    async completeMessage() { events.push('complete'); },
    async abandonMessage() { events.push('abandon'); },
    async deadLetterMessage(_message, details) { events.push(['deadletter', details]); }
  };
}

function baseDependencies(overrides = {}) {
  return {
    validateScanRequestedMessage: () => ({ valid: true }),
    assertProviderRuntimeEnabled: () => {},
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

const config = {
  workerName: 'test-worker',
  serviceBus: { maxDeliveryCount: 5 },
  planResourceLimits: {},
  moduleTimeoutsMs: { resourcePreflight: 1000 },
  globalScanTimeoutSeconds: 30,
  maxResultBytes: 100000,
  resultCompressionThresholdBytes: 1000,
  networkGuard: {}
};

const logger = {
  info() {}, warn() {}, error() {}
};

test('Service Bus delivery count is interpreted as a one-based attempt count', () => {
  assert.equal(deliveryAttempt({ deliveryCount: 1 }), 1);
  assert.equal(deliveryAttempt({ deliveryCount: 5 }), 5);
  assert.equal(deliveryAttempt({ deliveryCount: 0 }), 1);
  assert.equal(deliveryAttempt({}), 1);
  assert.equal(retryExhausted({ deliveryCount: 4 }, config), false);
  assert.equal(retryExhausted({ deliveryCount: 5 }, config), true);
});

test('safe invalid-message identity accepts only two valid UUIDs', () => {
  assert.deepEqual(safeMessageIdentity(body), {
    scanId: body.scanId,
    tenantId: body.tenantId
  });
  assert.equal(safeMessageIdentity({ scanId: body.scanId, tenantId: 'bad' }), null);
  assert.equal(safeMessageIdentity(null), null);
});

test('validation errors are bounded and stripped to safe fields', () => {
  const compact = compactValidationErrors(Array.from({ length: 25 }, (_, index) => ({
    instancePath: `/field/${index}`,
    schemaPath: '#/required',
    keyword: 'required',
    message: 'x'.repeat(900),
    params: { shouldNotLeak: true }
  })));
  assert.equal(compact.length, 20);
  assert.equal(compact[0].message.length, 512);
  assert.equal('params' in compact[0], false);
});

test('invalid message with safe identity is persisted/refunded before dead-letter', async () => {
  const receiver = receiverRecorder();
  let rejected = null;

  await processScanMessage({
    message: { body, deliveryCount: 1, messageId: 'invalid-1' },
    receiver,
    config,
    logger,
    pg: {},
    dependencies: baseDependencies({
      validateScanRequestedMessage: () => ({
        valid: false,
        errors: [{ instancePath: '/modules', keyword: 'minItems', message: 'must not be empty' }]
      }),
      markRejectedMessage: async (_pg, payload) => {
        rejected = payload;
        return true;
      }
    })
  });

  assert.equal(rejected.scanId, body.scanId);
  assert.equal(rejected.tenantId, body.tenantId);
  assert.equal(rejected.errorCode, 'INVALID_SCAN_REQUEST');
  assert.equal(rejected.metadata.validationErrors.length, 1);
  assert.equal(receiver.events.length, 1);
  assert.equal(receiver.events[0][0], 'deadletter');
  assert.equal(receiver.events[0][1].deadLetterReason, 'INVALID_SCAN_REQUEST');
});

test('invalid message is abandoned if its failure state cannot be persisted', async () => {
  const receiver = receiverRecorder();

  await processScanMessage({
    message: { body, deliveryCount: 1, messageId: 'invalid-2' },
    receiver,
    config,
    logger,
    pg: {},
    dependencies: baseDependencies({
      validateScanRequestedMessage: () => ({ valid: false, errors: [] }),
      markRejectedMessage: async () => {
        throw new Error('database unavailable');
      }
    })
  });

  assert.deepEqual(receiver.events, ['abandon']);
});

test('invalid message without safe identity is dead-lettered without DB mutation', async () => {
  const receiver = receiverRecorder();
  let persisted = false;

  await processScanMessage({
    message: { body: { scanId: 'bad', tenantId: 'bad' }, deliveryCount: 1 },
    receiver,
    config,
    logger,
    pg: {},
    dependencies: baseDependencies({
      validateScanRequestedMessage: () => ({ valid: false, errors: [] }),
      markRejectedMessage: async () => { persisted = true; }
    })
  });

  assert.equal(persisted, false);
  assert.equal(receiver.events[0][0], 'deadletter');
});

test('retryable failure is persisted and message is abandoned', async () => {
  const receiver = receiverRecorder();
  let retryPersisted = false;
  let terminalPersisted = false;

  await processScanMessage({
    message: { body, deliveryCount: 1, messageId: 'm1' },
    receiver,
    config,
    logger,
    pg: {},
    dependencies: baseDependencies({
      runAudit: async () => {
        throw new RetryableWorkerError('temporary outage');
      },
      markRetryable: async () => { retryPersisted = true; return true; },
      markFailed: async () => { terminalPersisted = true; return true; }
    })
  });

  assert.equal(retryPersisted, true);
  assert.equal(terminalPersisted, false);
  assert.deepEqual(receiver.events, ['abandon']);
});

test('retryable failure is dead-lettered at max delivery count', async () => {
  const receiver = receiverRecorder();
  let attemptStatus = null;

  await processScanMessage({
    message: { body, deliveryCount: 5, messageId: 'm2' },
    receiver,
    config,
    logger,
    pg: {},
    dependencies: baseDependencies({
      runAudit: async () => {
        throw new RetryableWorkerError('temporary outage');
      },
      markFailed: async (_pg, payload) => {
        attemptStatus = payload.attemptStatus;
        return true;
      }
    })
  });

  assert.equal(attemptStatus, 'DEAD_LETTERED');
  assert.equal(receiver.events[0][0], 'deadletter');
  assert.equal(receiver.events[0][1].deadLetterReason, 'RETRY_EXHAUSTED');
});

test('an unsettled delivery that still owns the scan is abandoned instead of completed', async () => {
  const receiver = receiverRecorder();

  await processScanMessage({
    message: { body, deliveryCount: 2, messageId: 'm-owned' },
    receiver,
    config,
    logger,
    pg: {},
    dependencies: baseDependencies({
      beginAttempt: async () => ({
        acquired: false,
        reason: 'SCAN_NOT_ACQUIRABLE',
        current: {
          status: 'IN_PROGRESS',
          current_message_id: 'm-owned'
        }
      })
    })
  });

  assert.deepEqual(receiver.events, ['abandon']);
});

test('a duplicate message for an already-settled scan is completed', async () => {
  const receiver = receiverRecorder();

  await processScanMessage({
    message: { body, deliveryCount: 2, messageId: 'm-duplicate' },
    receiver,
    config,
    logger,
    pg: {},
    dependencies: baseDependencies({
      beginAttempt: async () => ({
        acquired: false,
        reason: 'SCAN_NOT_ACQUIRABLE',
        current: {
          status: 'DONE',
          current_message_id: 'm-original'
        }
      })
    })
  });

  assert.deepEqual(receiver.events, ['complete']);
});

test('terminal failures pass the partial result to the sanitizing persistence boundary', async () => {
  const receiver = receiverRecorder();
  let persistedResult = null;
  const cause = new Error('module failed');
  cause.partialResult = {
    durationMs: 42,
    completedModules: ['storage'],
    connectionString: 'Endpoint=sb://secret.example/'
  };

  await processScanMessage({
    message: { body, deliveryCount: 1, messageId: 'm-terminal' },
    receiver,
    config,
    logger,
    pg: {},
    dependencies: baseDependencies({
      runAudit: async () => {
        throw new TerminalWorkerError('terminal module failure', {
          code: 'MODULE_TERMINAL_FAILURE',
          publicMessage: 'The scan module failed permanently.',
          cause
        });
      },
      markFailed: async (_pg, payload) => {
        persistedResult = payload.result;
        return true;
      }
    })
  });

  assert.deepEqual(receiver.events, ['complete']);
  assert.equal(persistedResult.durationMs, 42);
  assert.deepEqual(persistedResult.completedModules, ['storage']);
  assert.equal(persistedResult.connectionString, 'Endpoint=sb://secret.example/');
  assert.equal(persistedResult.error.code, 'MODULE_TERMINAL_FAILURE');
});
