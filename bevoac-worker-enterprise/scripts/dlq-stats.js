if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}
const { getConfig } = require('../src/config/env');
const { buildServiceBusClient } = require('../src/lib/servicebus');

async function main() {
  const config = getConfig();
  const client = buildServiceBusClient(config);
  const receiver = client.createReceiver(config.serviceBus.queueName, { subQueueType: 'deadLetter' });
  try {
    const max = Number(process.env.MAX_PEEK || 50);
    const messages = await receiver.peekMessages(max);
    const grouped = {};
    for (const msg of messages) {
      const reason = msg.deadLetterReason || 'UNKNOWN';
      grouped[reason] = (grouped[reason] || 0) + 1;
    }
    console.log(JSON.stringify({ queue: config.serviceBus.queueName, peeked: messages.length, byReason: grouped, samples: messages.slice(0, 10).map((m) => ({ messageId: m.messageId, reason: m.deadLetterReason, error: m.deadLetterErrorDescription, enqueuedTimeUtc: m.enqueuedTimeUtc, tenantId: m.applicationProperties?.tenantId, scanId: m.applicationProperties?.scanId })) }, null, 2));
  } finally {
    await receiver.close();
    await client.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
