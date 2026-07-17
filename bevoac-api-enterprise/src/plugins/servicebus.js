const fp = require('fastify-plugin');
const { DefaultAzureCredential } = require('@azure/identity');
const { ServiceBusClient } = require('@azure/service-bus');

module.exports = fp(async function serviceBusPlugin(fastify) {
  const sb = fastify.config.serviceBus;
  let client;
  if (sb.authMode === 'managed_identity') {
    client = new ServiceBusClient(sb.fullyQualifiedNamespace, new DefaultAzureCredential());
    fastify.log.info({ namespace: sb.fullyQualifiedNamespace }, 'Service Bus configured with managed identity.');
  } else {
    client = new ServiceBusClient(sb.connectionString);
    fastify.log.warn('Service Bus configured with connection string fallback. Use managed identity in production.');
  }
  const sender = client.createSender(sb.queueName);

  fastify.decorate('serviceBus', {
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
    }
  });

  fastify.addHook('onClose', async () => {
    await sender.close();
    await client.close();
  });
});
