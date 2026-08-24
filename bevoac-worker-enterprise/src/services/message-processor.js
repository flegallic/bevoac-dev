'use strict';

const { randomUUID } = require('crypto');
const { assertProviderRuntimeEnabled } = require('../providers/provider-registry');
const {
  classifyWorkerError,
  safeErrorProjection,
  publicFailurePayload,
  TerminalWorkerError
} = require('../lib/worker-errors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeMessageIdentity(body) {
  const scanId = String(body?.scanId || '').trim().toLowerCase();
  const tenantId = String(body?.tenantId || '').trim().toLowerCase();
  if (!UUID_RE.test(scanId) || !UUID_RE.test(tenantId)) return null;
  return { scanId, tenantId };
}

function compactValidationErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 20).map((error) => ({
    instancePath: String(error?.instancePath || '').slice(0, 512),
    schemaPath: String(error?.schemaPath || '').slice(0, 512),
    keyword: String(error?.keyword || '').slice(0, 120),
    message: String(error?.message || 'invalid message').slice(0, 512)
  }));
}

function resolveResourceLimit(config, message) {
  if (message?.limits && Object.prototype.hasOwnProperty.call(message.limits, 'resourceLimit')) {
    return message.limits.resourceLimit == null ? null : Number(message.limits.resourceLimit);
  }
  const planCode = message?.limits?.planCode;
  if (planCode && Object.prototype.hasOwnProperty.call(config.planResourceLimits, planCode)) {
    return config.planResourceLimits[planCode];
  }
  return null;
}

// Azure Service Bus exposes the current delivery as a one-based count.
function deliveryAttempt(message) {
  const count = Number(message?.deliveryCount);
  return Number.isInteger(count) && count >= 1 ? count : 1;
}

function retryExhausted(message, config) {
  return deliveryAttempt(message) >= Number(config.serviceBus.maxDeliveryCount || 5);
}

let cachedDefaultDependencies = null;

function buildDefaultDependencies() {
  if (cachedDefaultDependencies) return cachedDefaultDependencies;
  const { validateScanRequestedMessage } = require('../lib/contract-validator');
  const { buildCrossTenantCredential } = require('../lib/azure-credentials');
  const { hasInfraModules, countAzureResources } = require('../lib/resource-preflight');
  const { withTimeout } = require('../lib/module-timeout');
  const { runAudit } = require('./audit-runner');
  const {
    beginAttempt,
    markResourcePreflight,
    markCompleted,
    markRetryable,
    markFailed,
    markRejectedMessage
  } = require('./scan-store');

  cachedDefaultDependencies = Object.freeze({
    validateScanRequestedMessage,
    buildCrossTenantCredential,
    hasInfraModules,
    countAzureResources,
    withTimeout,
    runAudit,
    beginAttempt,
    markResourcePreflight,
    markCompleted,
    markRetryable,
    markFailed,
    markRejectedMessage,
    assertProviderRuntimeEnabled
  });
  return cachedDefaultDependencies;
}

const REQUIRED_DEPENDENCY_KEYS = Object.freeze([
  'validateScanRequestedMessage',
  'buildCrossTenantCredential',
  'hasInfraModules',
  'countAzureResources',
  'withTimeout',
  'runAudit',
  'beginAttempt',
  'markResourcePreflight',
  'markCompleted',
  'markRetryable',
  'markFailed',
  'markRejectedMessage',
  'assertProviderRuntimeEnabled'
]);

function hasCompleteDependencyOverrides(overrides) {
  return Boolean(
    overrides &&
    REQUIRED_DEPENDENCY_KEYS.every((key) => typeof overrides[key] === 'function')
  );
}

function mergeDependencies(overrides = null) {
  if (!overrides) return buildDefaultDependencies();

  // Tests and isolated runners can inject a complete dependency set without
  // loading Azure SDK, AJV or PostgreSQL modules. Runtime callers that provide
  // only partial overrides still inherit every production dependency.
  if (hasCompleteDependencyOverrides(overrides)) {
    return Object.freeze({ ...overrides });
  }

  return Object.freeze({ ...buildDefaultDependencies(), ...overrides });
}

async function persistTerminalFailure({
  deps,
  pg,
  scanId,
  tenantId,
  attemptId,
  failure,
  config,
  attemptStatus = 'FAILED'
}) {
  const publicFailure = publicFailurePayload(failure, attemptId);
  const originalPartialResult = failure?.cause?.partialResult;
  const safeResult = originalPartialResult && typeof originalPartialResult === 'object'
    ? { ...originalPartialResult, error: publicFailure }
    : { durationMs: 0, error: publicFailure, kpiScorecard: null };
  const persisted = await deps.markFailed(pg, {
    scanId,
    tenantId,
    attemptId,
    errorMessage: publicFailure.message,
    errorCode: publicFailure.code,
    correlationId: attemptId,
    result: safeResult,
    attemptStatus,
    maxResultBytes: config.maxResultBytes,
    compressionThresholdBytes: config.resultCompressionThresholdBytes
  });
  return { publicFailure, persisted };
}

async function processScanMessage({ message, receiver, config, logger, pg, dependencies = null }) {
  const deps = mergeDependencies(dependencies);
  const body = message.body;
  const validation = deps.validateScanRequestedMessage(body);

  if (!validation.valid) {
    const errors = compactValidationErrors(validation.errors);
    const identity = safeMessageIdentity(body);
    logger.error({ errors, identity }, 'Invalid scan request received.');

    if (identity) {
      const rejectionAttemptId = randomUUID();
      try {
        await deps.markRejectedMessage(pg, {
          ...identity,
          attemptId: rejectionAttemptId,
          workerName: config.workerName,
          messageId: message.messageId || identity.scanId,
          deliveryCount: message.deliveryCount ?? null,
          errorCode: 'INVALID_SCAN_REQUEST',
          errorMessage: 'The queued scan request failed contract validation.',
          metadata: { validationErrors: errors },
          maxResultBytes: config.maxResultBytes,
          compressionThresholdBytes: config.resultCompressionThresholdBytes
        });
      } catch (persistenceError) {
        logger.error(
          { error: safeErrorProjection(persistenceError), identity },
          'Unable to persist invalid-message rejection; abandoning for a later persistence attempt.'
        );
        await receiver.abandonMessage(message);
        return;
      }
    }

    await receiver.deadLetterMessage(message, {
      deadLetterReason: 'INVALID_SCAN_REQUEST',
      deadLetterErrorDescription: JSON.stringify(errors).slice(0, 4096)
    });
    return;
  }

  const { scanId, tenantId, cloudProvider, modules, azure } = body;
  const attemptId = randomUUID();
  logger.info({
    scanId,
    tenantId,
    cloudProvider,
    modules,
    attemptId,
    deliveryAttempt: deliveryAttempt(message)
  }, 'Processing scan request.');
  let acquired = false;

  try {
    const started = await deps.beginAttempt(pg, {
      scanId,
      tenantId,
      attemptId,
      workerName: config.workerName,
      messageId: message.messageId || body.scanId,
      deliveryCount: message.deliveryCount ?? null
    });
    acquired = started.acquired;

    if (!acquired) {
      const sameMessageStillInProgress = Boolean(
        started.current?.status === 'IN_PROGRESS' &&
        started.current?.current_message_id &&
        message.messageId &&
        String(started.current.current_message_id) === String(message.messageId)
      );
      logger.warn({ scanId, tenantId, current: started.current, reason: started.reason }, 'Scan message was not acquired.');
      if (sameMessageStillInProgress) {
        await receiver.abandonMessage(message);
      } else {
        await receiver.completeMessage(message);
      }
      return;
    }

    try {
      deps.assertProviderRuntimeEnabled(cloudProvider);
    } catch (cause) {
      throw new TerminalWorkerError('Declared cloud provider is not runtime-enabled.', {
        code: 'PROVIDER_NOT_RUNTIME_ENABLED',
        publicMessage: 'The requested cloud provider is not enabled for this release.',
        cause
      });
    }

    const infraCredential = deps.buildCrossTenantCredential(config, azure.microsoftTenantId || null);
    const resourceLimit = resolveResourceLimit(config, body);
    let resourcePreflight = null;

    if (deps.hasInfraModules(modules)) {
      if (!infraCredential) {
        throw new TerminalWorkerError('Azure cross-tenant credential is unavailable.', {
          code: 'AZURE_CREDENTIAL_UNAVAILABLE',
          publicMessage: 'The verified Azure connection is unavailable or incomplete.'
        });
      }

      resourcePreflight = await deps.withTimeout(
        'resource preflight',
        config.moduleTimeoutsMs.resourcePreflight,
        ({ signal }) => deps.countAzureResources({
          credential: infraCredential,
          subscriptions: Array.isArray(azure.subscriptions) ? azure.subscriptions : [],
          logger,
          signal
        })
      );

      const preflightPersisted = await deps.markResourcePreflight(pg, {
        scanId,
        tenantId,
        attemptId,
        resourceCount: resourcePreflight.total,
        resourceLimit
      });
      if (preflightPersisted === false) {
        logger.warn({ scanId, tenantId, attemptId }, 'Resource preflight result ignored because the attempt no longer owns the scan.');
        return;
      }

      if (resourceLimit != null && resourcePreflight.total > resourceLimit) {
        const publicMessage = `Resource limit exceeded: ${resourcePreflight.total}/${resourceLimit}.`;
        const failed = await deps.markFailed(pg, {
          scanId,
          tenantId,
          attemptId,
          errorMessage: publicMessage,
          errorCode: 'RESOURCE_LIMIT_EXCEEDED',
          correlationId: attemptId,
          result: {
            durationMs: 0,
            resourcePreflight: { ...resourcePreflight, resourceLimit, code: 'RESOURCE_LIMIT_EXCEEDED' },
            error: {
              code: 'RESOURCE_LIMIT_EXCEEDED',
              message: publicMessage,
              correlationId: attemptId,
              retryable: false
            }
          },
          maxResultBytes: config.maxResultBytes,
          compressionThresholdBytes: config.resultCompressionThresholdBytes
        });
        if (failed === false) return;
        await receiver.completeMessage(message);
        logger.warn({ scanId, tenantId, resourceCount: resourcePreflight.total, resourceLimit }, 'Scan blocked by resource preflight limit.');
        return;
      }
    }

    const result = await deps.runAudit({
      targetUrl: azure.targetUrl || null,
      microsoftTenantId: azure.microsoftTenantId || null,
      subscriptions: Array.isArray(azure.subscriptions) ? azure.subscriptions : [],
      requestedModules: modules,
      infraCredential,
      timeoutMs: config.globalScanTimeoutSeconds * 1000,
      moduleTimeoutsMs: config.moduleTimeoutsMs,
      networkGuard: config.networkGuard,
      logger
    });

    if (resourcePreflight) result.resourcePreflight = { ...resourcePreflight, resourceLimit };

    const completed = await deps.markCompleted(pg, {
      scanId,
      tenantId,
      attemptId,
      result,
      maxResultBytes: config.maxResultBytes,
      compressionThresholdBytes: config.resultCompressionThresholdBytes
    });
    if (completed === false) {
      logger.warn({ scanId, tenantId, attemptId }, 'Completed result ignored because the attempt no longer owns the scan.');
      return;
    }
    await receiver.completeMessage(message);
    logger.info({
      scanId,
      tenantId,
      status: 'DONE',
      executionStatus: result?.azure_infrastructure?.executionStatus || null
    }, 'Scan processing finished.');
  } catch (error) {
    const failure = classifyWorkerError(error);
    logger.error({
      error: safeErrorProjection(failure),
      scanId,
      tenantId,
      attemptId,
      acquired,
      deliveryAttempt: deliveryAttempt(message)
    }, 'Worker failure while processing message.');

    if (!acquired) {
      await receiver.abandonMessage(message);
      return;
    }

    try {
      if (failure.retryable && !retryExhausted(message, config)) {
        const publicFailure = publicFailurePayload(failure, attemptId);
        const retryPersisted = await deps.markRetryable(pg, {
          scanId,
          tenantId,
          attemptId,
          errorCode: publicFailure.code,
          publicMessage: publicFailure.message,
          correlationId: attemptId,
          metadata: {
            deliveryAttempt: deliveryAttempt(message),
            maxDeliveryCount: config.serviceBus.maxDeliveryCount
          }
        });
        if (retryPersisted === false) {
          logger.warn({ scanId, tenantId, attemptId }, 'Retry state ignored because the attempt no longer owns the scan.');
          return;
        }
        await receiver.abandonMessage(message);
        logger.warn({ scanId, tenantId, attemptId, errorCode: publicFailure.code }, 'Retryable scan failure persisted; message abandoned for Service Bus retry.');
        return;
      }

      if (failure.retryable) {
        const terminal = await persistTerminalFailure({
          deps,
          pg,
          scanId,
          tenantId,
          attemptId,
          failure,
          config,
          attemptStatus: 'DEAD_LETTERED'
        });
        if (terminal.persisted === false) return;
        await receiver.deadLetterMessage(message, {
          deadLetterReason: 'RETRY_EXHAUSTED',
          deadLetterErrorDescription: `${terminal.publicFailure.code}: ${terminal.publicFailure.message}`.slice(0, 4096)
        });
        return;
      }

      if (failure.code === 'PROVIDER_NOT_RUNTIME_ENABLED') {
        const terminal = await persistTerminalFailure({
          deps,
          pg,
          scanId,
          tenantId,
          attemptId,
          failure,
          config,
          attemptStatus: 'DEAD_LETTERED'
        });
        if (terminal.persisted === false) return;
        await receiver.deadLetterMessage(message, {
          deadLetterReason: terminal.publicFailure.code,
          deadLetterErrorDescription: terminal.publicFailure.message.slice(0, 4096)
        });
        return;
      }

      const terminal = await persistTerminalFailure({
        deps,
        pg,
        scanId,
        tenantId,
        attemptId,
        failure,
        config
      });
      if (terminal.persisted === false) return;
      await receiver.completeMessage(message);
    } catch (persistenceError) {
      logger.error({
        error: safeErrorProjection(persistenceError),
        scanId,
        tenantId,
        attemptId
      }, 'Unable to persist worker failure; abandoning message for retry.');
      await receiver.abandonMessage(message);
    }
  }
}

module.exports = {
  buildDefaultDependencies,
  REQUIRED_DEPENDENCY_KEYS,
  hasCompleteDependencyOverrides,
  mergeDependencies,
  resolveResourceLimit,
  deliveryAttempt,
  retryExhausted,
  safeMessageIdentity,
  compactValidationErrors,
  processScanMessage
};
