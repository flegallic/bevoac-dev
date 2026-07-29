#!/usr/bin/env node
try {
  require('@dotenvx/dotenvx').config({ path: ['.env.local', '.env'] });
} catch (_) {
  try { require('dotenv').config(); } catch (_) {}
}

const { ServiceBusClient } = require('@azure/service-bus');
const { DefaultAzureCredential, ManagedIdentityCredential } = require('@azure/identity');

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getCredential() {
  if (process.env.SERVICEBUS_AUTH_MODE === 'connection_string') return null;
  if (process.env.AZURE_CLIENT_ID) {
    return new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID);
  }
  return new DefaultAzureCredential();
}

function createClient() {
  if (process.env.SERVICEBUS_AUTH_MODE === 'connection_string') {
    if (!process.env.SERVICEBUS_CONNECTION_STRING) {
      throw new Error('SERVICEBUS_CONNECTION_STRING is required when SERVICEBUS_AUTH_MODE=connection_string.');
    }
    return new ServiceBusClient(process.env.SERVICEBUS_CONNECTION_STRING);
  }

  const namespace = process.env.SERVICEBUS_FQ_NAMESPACE || process.env.SERVICEBUS_NAMESPACE;
  if (!namespace) {
    throw new Error('SERVICEBUS_FQ_NAMESPACE is required for managed identity Service Bus access.');
  }

  return new ServiceBusClient(namespace, getCredential());
}

async function receiveFromSessionDlq(client, queueName, sessionId, batchSize) {
  const receiver = sessionId
    ? await client.acceptSession(queueName, sessionId, {
        subQueueType: 'deadLetter',
        receiveMode: 'peekLock'
      })
    : await client.acceptNextSession(queueName, {
        subQueueType: 'deadLetter',
        receiveMode: 'peekLock'
      });

  try {
    return { receiver, messages: await receiver.receiveMessages(batchSize, { maxWaitTimeInMs: 5000 }) };
  } catch (error) {
    await receiver.close().catch(() => {});
    throw error;
  }
}

async function purgeSessionDlq({ client, queueName, sessionId, batchSize, dryRun }) {
  let purged = 0;
  let inspected = 0;

  while (true) {
    let receiver;
    let messages;

    try {
      ({ receiver, messages } = await receiveFromSessionDlq(client, queueName, sessionId, batchSize));
    } catch (error) {
      if (String(error.message || '').includes('No unlocked sessions')) break;
      if (String(error.code || '').includes('SessionCannotBeLocked')) break;
      throw error;
    }

    try {
      if (messages.length === 0) break;

      for (const message of messages) {
        inspected += 1;
        console.log(JSON.stringify({
          action: dryRun ? 'would_complete_dlq_message' : 'complete_dlq_message',
          messageId: message.messageId || null,
          sessionId: message.sessionId || null,
          correlationId: message.correlationId || null,
          deadLetterReason: message.deadLetterReason || message.applicationProperties?.DeadLetterReason || null,
          enqueuedTimeUtc: message.enqueuedTimeUtc || null
        }));

        if (!dryRun) {
          await receiver.completeMessage(message);
          purged += 1;
        }
      }
    } finally {
      await receiver.close().catch(() => {});
    }

    if (sessionId && messages.length < batchSize) break;
  }

  return { inspected, purged };
}

async function purgeNonSessionDlq({ client, queueName, batchSize, dryRun }) {
  const receiver = client.createReceiver(queueName, {
    subQueueType: 'deadLetter',
    receiveMode: 'peekLock'
  });

  let purged = 0;
  let inspected = 0;

  try {
    while (true) {
      const messages = await receiver.receiveMessages(batchSize, { maxWaitTimeInMs: 5000 });
      if (messages.length === 0) break;

      for (const message of messages) {
        inspected += 1;
        console.log(JSON.stringify({
          action: dryRun ? 'would_complete_dlq_message' : 'complete_dlq_message',
          messageId: message.messageId || null,
          sessionId: message.sessionId || null,
          correlationId: message.correlationId || null,
          deadLetterReason: message.deadLetterReason || message.applicationProperties?.DeadLetterReason || null,
          enqueuedTimeUtc: message.enqueuedTimeUtc || null
        }));

        if (!dryRun) {
          await receiver.completeMessage(message);
          purged += 1;
        }
      }
    }
  } finally {
    await receiver.close().catch(() => {});
  }

  return { inspected, purged };
}

async function main() {
  const queueName = arg('queue', process.env.SERVICEBUS_QUEUE_NAME || 'scan-jobs');
  const sessionId = arg('session', process.env.DLQ_SESSION_ID || null);
  const batchSize = Number(arg('batch-size', '20'));
  const sessionsEnabled = String(arg('sessions', process.env.SERVICEBUS_SESSIONS_ENABLED || 'true')).toLowerCase() === 'true';
  const dryRun = !hasFlag('yes');

  const client = createClient();

  try {
    const result = sessionsEnabled
      ? await purgeSessionDlq({ client, queueName, sessionId, batchSize, dryRun })
      : await purgeNonSessionDlq({ client, queueName, batchSize, dryRun });

    console.log(JSON.stringify({
      queueName,
      sessionId,
      sessionsEnabled,
      dryRun,
      inspected: result.inspected,
      purged: result.purged
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
