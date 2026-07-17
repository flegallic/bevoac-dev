#!/usr/bin/env node
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const { getConfig } = require('../src/config/env');
const { Pool } = require('pg');
const { DefaultAzureCredential } = require('@azure/identity');
const { ServiceBusClient } = require('@azure/service-bus');
const { OutboxService } = require('../src/services/outbox-service');

function buildPgPool(config) {
  return new Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
    max: Number(process.env.OUTBOX_PG_POOL_MAX || 5),
    ssl: config.postgres.ssl,
    application_name: 'bevoac-outbox-publisher-enterprise',
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
}


function buildServiceBusPublisher(sb) {
  const client = sb.authMode === 'managed_identity'
    ? new ServiceBusClient(sb.fullyQualifiedNamespace, new DefaultAzureCredential())
    : new ServiceBusClient(sb.connectionString);
  const sender = client.createSender(sb.queueName);
  return {
    queueName: sb.queueName,
    sessionsEnabled: sb.sessionsEnabled,
    async sendScanRequested(message) {
      const envelope = {
        body: message,
        contentType: 'application/json',
        subject: 'scan.requested',
        messageId: message.scanId,
        correlationId: message.requestId || message.scanId,
        applicationProperties: {
          tenantId: message.tenantId,
          scanId: message.scanId,
          scanProfile: message.scanProfile,
          planCode: message.limits?.planCode || null
        },
        timeToLive: sb.ttlSeconds * 1000
      };
      if (sb.sessionsEnabled) envelope.sessionId = String(message.tenantId);
      await sender.sendMessages(envelope);
    },
    async close() {
      await sender.close();
      await client.close();
    }
  };
}

function buildLogger() {
  function line(level, payload, message) {
    const record = {
      level,
      time: new Date().toISOString(),
      service: 'bevoac-outbox-publisher-enterprise',
      message,
      ...payload
    };
    const out = JSON.stringify(record);
    if (level === 'error') console.error(out);
    else console.log(out);
  }
  return {
    info: (payload, message) => line('info', payload || {}, message || ''),
    warn: (payload, message) => line('warn', payload || {}, message || ''),
    error: (payload, message) => {
      const normalized = { ...(payload || {}) };
      if (normalized.err instanceof Error) normalized.err = { name: normalized.err.name, message: normalized.err.message, stack: normalized.err.stack };
      line('error', normalized, message || '');
    }
  };
}

async function main() {
  const config = getConfig();
  const logger = buildLogger();
  const pg = buildPgPool(config);
  const serviceBus = buildServiceBusPublisher(config.serviceBus);
  const publisher = new OutboxService(pg, serviceBus, config, logger);

  const intervalMs = Number(process.env.OUTBOX_PUBLISH_INTERVAL_MS || config.outbox?.publishIntervalMs || 5000);
  const batchSize = Number(process.env.OUTBOX_PUBLISH_BATCH_SIZE || config.outbox?.batchSize || 25);
  const maxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS || config.outbox?.maxAttempts || 10);
  let stopping = false;
  let running = false;

  async function tick() {
    if (stopping || running) return;
    running = true;
    try {
      const stats = await publisher.publishPending({ limit: batchSize, maxAttempts });
      if (stats.claimed || stats.published || stats.failed) logger.info({ stats }, 'Outbox publisher tick completed.');
    } catch (error) {
      logger.error({ err: error }, 'Outbox publisher tick failed.');
    } finally {
      running = false;
    }
  }

  const client = await pg.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }

  logger.info({ intervalMs, batchSize, maxAttempts, queueName: config.serviceBus.queueName, authMode: config.serviceBus.authMode }, 'Outbox publisher daemon started.');
  const timer = setInterval(tick, intervalMs);
  await tick();

  async function shutdown(signal) {
    stopping = true;
    clearInterval(timer);
    logger.info({ signal }, 'Stopping outbox publisher daemon.');
    while (running) await new Promise((resolve) => setTimeout(resolve, 100));
    try { await serviceBus.close?.(); } catch (error) { logger.warn({ err: error }, 'Service Bus close failed.'); }
    await pg.end();
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
