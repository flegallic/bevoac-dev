if (process.env.NODE_ENV !== 'production') { try { require('dotenv').config(); } catch (_) {} }
const { Pool } = require('pg');
const { getConfig } = require('../src/config/env');
const { OutboxService } = require('../src/services/outbox-service');
const { ServiceBusClient } = require('@azure/service-bus');
const { DefaultAzureCredential } = require('@azure/identity');

function buildServiceBus(config) {
  const sb = config.serviceBus;
  const client = sb.authMode === 'managed_identity' ? new ServiceBusClient(sb.fullyQualifiedNamespace, new DefaultAzureCredential()) : new ServiceBusClient(sb.connectionString);
  const sender = client.createSender(sb.queueName);
  return {
    async sendScanRequested(message) {
      const envelope = { body: message, contentType: 'application/json', subject: 'scan.requested', messageId: message.scanId, correlationId: message.requestId || message.scanId, applicationProperties: { tenantId: message.tenantId, scanId: message.scanId, scanProfile: message.scanProfile, planCode: message.limits?.planCode || null }, timeToLive: sb.ttlSeconds * 1000 };
      if (sb.sessionsEnabled) envelope.sessionId = String(message.tenantId);
      await sender.sendMessages(envelope);
    },
    async close() { await sender.close(); await client.close(); }
  };
}
async function main() {
  const config = getConfig();
  const pool = new Pool({ ...config.postgres, application_name: 'bevoac-outbox-publisher' });
  const serviceBus = buildServiceBus(config);
  try {
    const publisher = new OutboxService(pool, serviceBus, config, console);
    console.log(JSON.stringify(await publisher.publishPending(), null, 2));
  } finally {
    await serviceBus.close();
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
