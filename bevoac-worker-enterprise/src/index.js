'use strict';

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const { getConfig } = require('./config/env');
const { buildLogger } = require('./lib/logger');
const { buildPgPool } = require('./lib/postgres');
const { buildServiceBusClient } = require('./lib/servicebus');
const {
  processScanMessage,
  resolveResourceLimit
} = require('./services/message-processor');

async function runStandardReceiver({
  sbClient,
  config,
  logger,
  pg,
  shutdownHandlers
}) {
  const receiver = sbClient.createReceiver(
    config.serviceBus.queueName
  );

  shutdownHandlers.push(async () => receiver.close());

  receiver.subscribe(
    {
      processMessage: (message) => processScanMessage({
        message,
        receiver,
        config,
        logger,
        pg
      }),
      processError: async (args) => logger.error(
        {
          source: args.errorSource,
          entityPath: args.entityPath,
          namespace: args.fullyQualifiedNamespace,
          err: args.error
        },
        'Service Bus receiver error.'
      )
    },
    {
      autoCompleteMessages: false,
      maxConcurrentCalls: config.receiverMaxConcurrentCalls,
      maxAutoLockRenewalDurationInMs:
        config.globalScanTimeoutSeconds * 1000 + 60000
    }
  );
}

async function sessionLoop({
  sbClient,
  config,
  logger,
  pg,
  shouldStop
}) {
  while (!shouldStop.value) {
    let receiver;

    try {
      receiver = await sbClient.acceptNextSession(
        config.serviceBus.queueName,
        {
          maxAutoLockRenewalDurationInMs:
            config.globalScanTimeoutSeconds * 1000 + 60000
        }
      );

      logger.info(
        { sessionId: receiver.sessionId },
        'Accepted tenant Service Bus session.'
      );

      while (!shouldStop.value) {
        const messages = await receiver.receiveMessages(1, {
          maxWaitTimeInMs: 5000
        });

        if (messages.length === 0) break;

        await processScanMessage({
          message: messages[0],
          receiver,
          config,
          logger,
          pg
        });
      }
    } catch (error) {
      if (!shouldStop.value) {
        logger.warn(
          { err: error },
          'Session receiver loop iteration failed.'
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      if (receiver) await receiver.close().catch(() => {});
    }
  }
}

async function runSessionReceivers({
  sbClient,
  config,
  logger,
  pg,
  shutdownHandlers
}) {
  const shouldStop = { value: false };
  const loops = [];

  for (
    let index = 0;
    index < config.maxConcurrentTenantSessions;
    index += 1
  ) {
    loops.push(sessionLoop({
      sbClient,
      config,
      logger,
      pg,
      shouldStop
    }));
  }

  shutdownHandlers.push(async () => {
    shouldStop.value = true;
    await Promise.allSettled(loops);
  });
}

async function startWorker() {
  const config = getConfig();
  const logger = buildLogger(config);
  const pg = buildPgPool(config);
  const sbClient = buildServiceBusClient(config);
  const shutdownHandlers = [];

  const ping = await pg.connect();
  try {
    await ping.query('SELECT 1');
  } finally {
    ping.release();
  }

  logger.info(
    {
      queueName: config.serviceBus.queueName,
      authMode: config.serviceBus.authMode,
      sessionsEnabled: config.serviceBus.sessionsEnabled
    },
    'Worker started.'
  );

  if (config.serviceBus.sessionsEnabled) {
    await runSessionReceivers({
      sbClient,
      config,
      logger,
      pg,
      shutdownHandlers
    });
  } else {
    await runStandardReceiver({
      sbClient,
      config,
      logger,
      pg,
      shutdownHandlers
    });
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Stopping worker.');

    for (const handler of shutdownHandlers) {
      await handler().catch((error) => logger.warn(
        { err: error },
        'Shutdown handler failed.'
      ));
    }

    await sbClient.close();
    await pg.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  startWorker().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  startWorker,
  resolveResourceLimit,
  processScanMessage
};
