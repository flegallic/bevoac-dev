'use strict';

const { randomUUID } = require('crypto');
const {
  assertProviderRuntimeEnabled
} = require('../providers/provider-registry');

function resolveResourceLimit(config, message) {
  if (
    message?.limits &&
    Object.prototype.hasOwnProperty.call(
      message.limits,
      'resourceLimit'
    )
  ) {
    return message.limits.resourceLimit == null
      ? null
      : Number(message.limits.resourceLimit);
  }

  const planCode = message?.limits?.planCode;

  if (
    planCode &&
    Object.prototype.hasOwnProperty.call(
      config.planResourceLimits,
      planCode
    )
  ) {
    return config.planResourceLimits[planCode];
  }

  return null;
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
    markFailed
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
    markFailed,
    assertProviderRuntimeEnabled
  });

  return cachedDefaultDependencies;
}

function mergeDependencies(overrides = null) {
  if (!overrides) return buildDefaultDependencies();
  return Object.freeze({ ...overrides });
}

async function processScanMessage({
  message,
  receiver,
  config,
  logger,
  pg,
  dependencies = null
}) {
  const deps = mergeDependencies(dependencies);
  const body = message.body;
  const validation = deps.validateScanRequestedMessage(body);

  if (!validation.valid) {
    logger.error(
      { errors: validation.errors },
      'Invalid scan request received; dead-lettering message.'
    );

    await receiver.deadLetterMessage(message, {
      deadLetterReason: 'INVALID_SCAN_REQUEST',
      deadLetterErrorDescription: JSON.stringify(
        validation.errors
      ).slice(0, 4096)
    });
    return;
  }

  const {
    scanId,
    tenantId,
    cloudProvider,
    modules,
    azure
  } = body;

  try {
    deps.assertProviderRuntimeEnabled(cloudProvider);
  } catch (error) {
    logger.error(
      { err: error, cloudProvider, scanId, tenantId },
      'Cloud provider is not runtime-enabled; dead-lettering message.'
    );

    await receiver.deadLetterMessage(message, {
      deadLetterReason: 'PROVIDER_NOT_RUNTIME_ENABLED',
      deadLetterErrorDescription: String(error.message || error).slice(
        0,
        4096
      )
    });
    return;
  }

  const attemptId = randomUUID();

  logger.info(
    { scanId, tenantId, cloudProvider, modules, attemptId },
    'Processing scan request.'
  );

  let acquired = false;

  try {
    const started = await deps.beginAttempt(pg, {
      scanId,
      tenantId,
      attemptId,
      workerName: config.workerName,
      messageId: message.messageId || body.scanId,
      deliveryCount: message.deliveryCount || null
    });

    acquired = started.acquired;

    if (!acquired) {
      logger.warn(
        { scanId, tenantId, current: started.current },
        'Skipping duplicate or non-pending scan message.'
      );
      await receiver.completeMessage(message);
      return;
    }

    const infraCredential = deps.buildCrossTenantCredential(
      config,
      azure.microsoftTenantId || null
    );
    const resourceLimit = resolveResourceLimit(config, body);
    let resourcePreflight = null;

    if (deps.hasInfraModules(modules)) {
      if (!infraCredential) {
        throw new Error(
          'Azure infrastructure modules were requested but no ' +
          'cross-tenant credential could be created.'
        );
      }

      resourcePreflight = await deps.withTimeout(
        'resource preflight',
        config.moduleTimeoutsMs.resourcePreflight,
        () => deps.countAzureResources({
          credential: infraCredential,
          subscriptions: Array.isArray(azure.subscriptions)
            ? azure.subscriptions
            : [],
          logger
        })
      );

      await deps.markResourcePreflight(
        pg,
        scanId,
        tenantId,
        resourcePreflight.total,
        resourceLimit
      );

      if (
        resourceLimit != null &&
        resourcePreflight.total > resourceLimit
      ) {
        const result = {
          durationMs: 0,
          webSecurity: null,
          microsoft_entra: null,
          azure_infrastructure: null,
          resourcePreflight: {
            ...resourcePreflight,
            resourceLimit,
            code: 'RESOURCE_LIMIT_EXCEEDED'
          },
          error:
            `Resource limit exceeded: ` +
            `${resourcePreflight.total}/${resourceLimit}.`
        };

        await deps.markFailed(pg, {
          scanId,
          tenantId,
          attemptId,
          errorMessage: result.error,
          result,
          maxResultBytes: config.maxResultBytes,
          compressionThresholdBytes:
            config.resultCompressionThresholdBytes
        });

        await receiver.completeMessage(message);

        logger.warn(
          {
            scanId,
            tenantId,
            resourceCount: resourcePreflight.total,
            resourceLimit
          },
          'Scan blocked by resource preflight limit.'
        );
        return;
      }
    }

    const result = await deps.runAudit({
      targetUrl: azure.targetUrl || null,
      microsoftTenantId: azure.microsoftTenantId || null,
      subscriptions: Array.isArray(azure.subscriptions)
        ? azure.subscriptions
        : [],
      requestedModules: modules,
      infraCredential,
      timeoutMs: config.globalScanTimeoutSeconds * 1000,
      moduleTimeoutsMs: config.moduleTimeoutsMs,
      networkGuard: config.networkGuard,
      logger
    });

    if (resourcePreflight) {
      result.resourcePreflight = {
        ...resourcePreflight,
        resourceLimit
      };
    }

    if (result.error) {
      await deps.markFailed(pg, {
        scanId,
        tenantId,
        attemptId,
        errorMessage: result.error,
        result,
        maxResultBytes: config.maxResultBytes,
        compressionThresholdBytes:
          config.resultCompressionThresholdBytes
      });
    } else {
      await deps.markCompleted(pg, {
        scanId,
        tenantId,
        attemptId,
        result,
        maxResultBytes: config.maxResultBytes,
        compressionThresholdBytes:
          config.resultCompressionThresholdBytes
      });
    }

    await receiver.completeMessage(message);

    logger.info(
      {
        scanId,
        tenantId,
        status: result.error ? 'FAILED' : 'DONE'
      },
      'Scan processing finished.'
    );
  } catch (error) {
    logger.error(
      { err: error, scanId, tenantId, attemptId, acquired },
      'Worker failure while processing message.'
    );

    if (acquired) {
      try {
        await deps.markFailed(pg, {
          scanId,
          tenantId,
          attemptId,
          errorMessage: error.message,
          result: { error: error.message },
          maxResultBytes: config.maxResultBytes,
          compressionThresholdBytes:
            config.resultCompressionThresholdBytes
        });
        await receiver.completeMessage(message);
      } catch (dbError) {
        logger.error(
          { err: dbError, scanId, tenantId, attemptId },
          'Unable to persist worker failure; abandoning message for retry.'
        );
        await receiver.abandonMessage(message);
      }
    } else {
      await receiver.abandonMessage(message);
    }
  }
}

module.exports = {
  buildDefaultDependencies,
  mergeDependencies,
  resolveResourceLimit,
  processScanMessage
};
