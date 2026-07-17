if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const { randomUUID } = require('crypto');
const { getConfig } = require('./config/env');
const { buildLogger } = require('./lib/logger');
const { buildPgPool } = require('./lib/postgres');
const { buildServiceBusClient } = require('./lib/servicebus');
const { validateScanRequestedMessage } = require('./lib/contract-validator');
const { buildCrossTenantCredential } = require('./lib/azure-credentials');
const { hasInfraModules, countAzureResources } = require('./lib/resource-preflight');
const { withTimeout } = require('./lib/module-timeout');
const { runAudit } = require('./services/audit-runner');
const { beginAttempt, markResourcePreflight, markCompleted, markFailed } = require('./services/scan-store');

function resolveResourceLimit(config, message) {
  if (message?.limits && Object.prototype.hasOwnProperty.call(message.limits, 'resourceLimit')) return message.limits.resourceLimit == null ? null : Number(message.limits.resourceLimit);
  const planCode = message?.limits?.planCode;
  if (planCode && Object.prototype.hasOwnProperty.call(config.planResourceLimits, planCode)) return config.planResourceLimits[planCode];
  return null;
}

async function processScanMessage({ message, receiver, config, logger, pg }) {
  const body = message.body;
  const validation = validateScanRequestedMessage(body);
  if (!validation.valid) {
    logger.error({ errors: validation.errors }, 'Invalid scan request received; dead-lettering message.');
    await receiver.deadLetterMessage(message, { deadLetterReason: 'INVALID_SCAN_REQUEST', deadLetterErrorDescription: JSON.stringify(validation.errors).slice(0, 4096) });
    return;
  }

  const { scanId, tenantId, modules, azure } = body;
  const attemptId = randomUUID();
  logger.info({ scanId, tenantId, modules, attemptId }, 'Processing scan request.');

  let acquired = false;
  try {
    const started = await beginAttempt(pg, {
      scanId,
      tenantId,
      attemptId,
      workerName: config.workerName,
      messageId: message.messageId || body.scanId,
      deliveryCount: message.deliveryCount || null
    });
    acquired = started.acquired;
    if (!acquired) {
      logger.warn({ scanId, tenantId, current: started.current }, 'Skipping duplicate or non-pending scan message.');
      await receiver.completeMessage(message);
      return;
    }

    const infraCredential = buildCrossTenantCredential(config, azure.microsoftTenantId || null);
    const resourceLimit = resolveResourceLimit(config, body);
    let resourcePreflight = null;
    if (hasInfraModules(modules)) {
      if (!infraCredential) throw new Error('Azure infrastructure modules were requested but no cross-tenant credential could be created.');
      resourcePreflight = await withTimeout('resource preflight', config.moduleTimeoutsMs.resourcePreflight, () => countAzureResources({ credential: infraCredential, subscriptions: Array.isArray(azure.subscriptions) ? azure.subscriptions : [], logger }));
      await markResourcePreflight(pg, scanId, tenantId, resourcePreflight.total, resourceLimit);
      if (resourceLimit != null && resourcePreflight.total > resourceLimit) {
        const result = { durationMs: 0, webSecurity: null, microsoft_entra: null, azure_infrastructure: null, resourcePreflight: { ...resourcePreflight, resourceLimit, code: 'RESOURCE_LIMIT_EXCEEDED' }, error: `Resource limit exceeded: ${resourcePreflight.total}/${resourceLimit}.` };
        await markFailed(pg, { scanId, tenantId, attemptId, errorMessage: result.error, result, maxResultBytes: config.maxResultBytes, compressionThresholdBytes: config.resultCompressionThresholdBytes });
        await receiver.completeMessage(message);
        logger.warn({ scanId, tenantId, resourceCount: resourcePreflight.total, resourceLimit }, 'Scan blocked by resource preflight limit.');
        return;
      }
    }

    const result = await runAudit({
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
    if (result.error) await markFailed(pg, { scanId, tenantId, attemptId, errorMessage: result.error, result, maxResultBytes: config.maxResultBytes, compressionThresholdBytes: config.resultCompressionThresholdBytes });
    else await markCompleted(pg, { scanId, tenantId, attemptId, result, maxResultBytes: config.maxResultBytes, compressionThresholdBytes: config.resultCompressionThresholdBytes });
    await receiver.completeMessage(message);
    logger.info({ scanId, tenantId, status: result.error ? 'FAILED' : 'DONE' }, 'Scan processing finished.');
  } catch (error) {
    logger.error({ err: error, scanId, tenantId, attemptId, acquired }, 'Worker failure while processing message.');
    if (acquired) {
      try {
        await markFailed(pg, { scanId, tenantId, attemptId, errorMessage: error.message, result: { error: error.message }, maxResultBytes: config.maxResultBytes, compressionThresholdBytes: config.resultCompressionThresholdBytes });
        await receiver.completeMessage(message);
      } catch (dbError) {
        logger.error({ err: dbError, scanId, tenantId, attemptId }, 'Unable to persist worker failure; abandoning message for retry.');
        await receiver.abandonMessage(message);
      }
    } else {
      await receiver.abandonMessage(message);
    }
  }
}

async function runStandardReceiver({ sbClient, config, logger, pg, shutdownHandlers }) {
  const receiver = sbClient.createReceiver(config.serviceBus.queueName);
  shutdownHandlers.push(async () => receiver.close());
  receiver.subscribe({
    processMessage: (message) => processScanMessage({ message, receiver, config, logger, pg }),
    processError: async (args) => logger.error({ source: args.errorSource, entityPath: args.entityPath, namespace: args.fullyQualifiedNamespace, err: args.error }, 'Service Bus receiver error.')
  }, { autoCompleteMessages: false, maxConcurrentCalls: config.receiverMaxConcurrentCalls, maxAutoLockRenewalDurationInMs: config.globalScanTimeoutSeconds * 1000 + 60000 });
}

async function sessionLoop({ sbClient, config, logger, pg, shouldStop }) {
  while (!shouldStop.value) {
    let receiver;
    try {
      receiver = await sbClient.acceptNextSession(config.serviceBus.queueName, { maxAutoLockRenewalDurationInMs: config.globalScanTimeoutSeconds * 1000 + 60000 });
      logger.info({ sessionId: receiver.sessionId }, 'Accepted tenant Service Bus session.');
      while (!shouldStop.value) {
        const messages = await receiver.receiveMessages(1, { maxWaitTimeInMs: 5000 });
        if (messages.length === 0) break;
        await processScanMessage({ message: messages[0], receiver, config, logger, pg });
      }
    } catch (error) {
      if (!shouldStop.value) logger.warn({ err: error }, 'Session receiver loop iteration failed.');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      if (receiver) await receiver.close().catch(() => {});
    }
  }
}

async function runSessionReceivers({ sbClient, config, logger, pg, shutdownHandlers }) {
  const shouldStop = { value: false };
  const loops = [];
  for (let i = 0; i < config.maxConcurrentTenantSessions; i += 1) loops.push(sessionLoop({ sbClient, config, logger, pg, shouldStop }));
  shutdownHandlers.push(async () => { shouldStop.value = true; await Promise.allSettled(loops); });
}

async function startWorker() {
  const config = getConfig();
  const logger = buildLogger(config);
  const pg = buildPgPool(config);
  const sbClient = buildServiceBusClient(config);
  const shutdownHandlers = [];

  const ping = await pg.connect();
  try { await ping.query('SELECT 1'); } finally { ping.release(); }
  logger.info({ queueName: config.serviceBus.queueName, authMode: config.serviceBus.authMode, sessionsEnabled: config.serviceBus.sessionsEnabled }, 'Worker started.');

  if (config.serviceBus.sessionsEnabled) await runSessionReceivers({ sbClient, config, logger, pg, shutdownHandlers });
  else await runStandardReceiver({ sbClient, config, logger, pg, shutdownHandlers });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Stopping worker.');
    for (const handler of shutdownHandlers) await handler().catch((error) => logger.warn({ err: error }, 'Shutdown handler failed.'));
    await sbClient.close();
    await pg.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) startWorker().catch((error) => { console.error(error); process.exit(1); });

module.exports = { startWorker, resolveResourceLimit, processScanMessage };
