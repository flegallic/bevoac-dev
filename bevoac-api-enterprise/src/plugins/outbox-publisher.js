const fp = require('fastify-plugin');
const { OutboxService } = require('../services/outbox-service');

module.exports = fp(async function outboxPublisherPlugin(fastify) {
  const cfg = fastify.config.outbox || {};
  const publisher = new OutboxService(fastify.pg, fastify.serviceBus, fastify.config, fastify.log);
  fastify.decorate('outboxPublisher', publisher);

  let timer = null;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const stats = await publisher.publishPending();
      if (stats.published || stats.failed) fastify.log.info({ stats }, 'Outbox publisher tick completed.');
    } catch (error) {
      fastify.log.error({ err: error }, 'Outbox publisher tick failed.');
    } finally {
      running = false;
    }
  }

  if (cfg.publisherEnabled !== false) {
    timer = setInterval(tick, Number(cfg.publishIntervalMs || process.env.OUTBOX_PUBLISH_INTERVAL_MS || 5000));
    timer.unref?.();
  }

  fastify.addHook('onClose', async () => { if (timer) clearInterval(timer); });
});
