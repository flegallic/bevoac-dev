if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}
const { getConfig } = require('../src/config/env');
const { buildServiceBusClient } = require('../src/lib/servicebus');

async function main() {
  const config = getConfig();
  const dryRun = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
  const maxMessages = Number(process.env.MAX_REPLAY || 10);
  const reasonFilter = process.env.REASON_FILTER || '';
  const client = buildServiceBusClient(config);
  const dlq = client.createReceiver(config.serviceBus.queueName, { subQueueType: 'deadLetter' });
  const sender = client.createSender(config.serviceBus.queueName);
  let replayed = 0;
  try {
    const messages = await dlq.receiveMessages(maxMessages, { maxWaitTimeInMs: 5000 });
    for (const msg of messages) {
      if (reasonFilter && msg.deadLetterReason !== reasonFilter) continue;
      const replayMessage = {
        body: msg.body,
        contentType: 'application/json',
        subject: 'scan.requested.replay',
        messageId: `${msg.messageId || msg.body?.scanId || Date.now()}-replay-${Date.now()}`,
        correlationId: msg.correlationId || msg.body?.scanId,
        applicationProperties: msg.applicationProperties || {},
        timeToLive: 300000
      };
      if (config.serviceBus.sessionsEnabled) replayMessage.sessionId = String(msg.body?.tenantId || msg.applicationProperties?.tenantId);
      if (!dryRun) {
        await sender.sendMessages(replayMessage);
        await dlq.completeMessage(msg);
      }
      replayed += 1;
    }
    console.log(JSON.stringify({ dryRun, replayed, maxMessages, reasonFilter: reasonFilter || null }, null, 2));
  } finally {
    await sender.close();
    await dlq.close();
    await client.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
