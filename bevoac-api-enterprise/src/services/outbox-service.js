const { AppError } = require('../lib/errors');

function outboxConfig(config = {}) {
  const c = config.outbox || config || {};
  return {
    batchSize: Number(c.batchSize || process.env.OUTBOX_PUBLISH_BATCH_SIZE || 25),
    maxAttempts: Number(c.maxAttempts || process.env.OUTBOX_MAX_ATTEMPTS || 10),
    baseBackoffSeconds: Number(c.baseBackoffSeconds || process.env.OUTBOX_BASE_BACKOFF_SECONDS || 15)
  };
}

class OutboxService {
  constructor(pg, serviceBus, config = {}, logger = console) {
    this.pg = pg;
    this.serviceBus = serviceBus;
    this.config = outboxConfig(config);
    this.logger = logger;
  }

  async enqueueScanRequested(client, { scanId, tenantId, message }) {
    await client.query(
      `
      INSERT INTO outbox_events (
        aggregate_type, aggregate_id, tenant_id, event_type, payload,
        status, attempts, next_attempt_at, created_at, updated_at
      ) VALUES ('scan', $1, $2, 'scan.requested', $3::jsonb, 'PENDING', 0, NOW(), NOW(), NOW())
      ON CONFLICT (event_type, aggregate_id)
      DO UPDATE SET payload = EXCLUDED.payload,
                    status = CASE WHEN outbox_events.status = 'PUBLISHED' THEN outbox_events.status ELSE 'PENDING' END,
                    next_attempt_at = CASE WHEN outbox_events.status = 'PUBLISHED' THEN outbox_events.next_attempt_at ELSE NOW() END,
                    updated_at = NOW()
      `,
      [scanId, tenantId, JSON.stringify(message)]
    );
  }

  async claimPending(client, { limit = 25, maxAttempts = 10 } = {}) {
    const result = await client.query(
      `
      WITH candidate AS (
        SELECT id
        FROM outbox_events
        WHERE event_type = 'scan.requested'
          AND (
            status IN ('PENDING','FAILED')
            OR (status = 'PROCESSING' AND locked_at < NOW() - INTERVAL '10 minutes')
          )
          AND attempts < $2
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events o
         SET status = 'PROCESSING', locked_at = NOW(), updated_at = NOW()
        FROM candidate
       WHERE o.id = candidate.id
       RETURNING o.id, o.aggregate_id, o.tenant_id, o.event_type, o.payload, o.attempts
      `,
      [limit, maxAttempts]
    );
    return result.rows;
  }

  async markPublished(client, id) {
    await client.query(
      `UPDATE outbox_events SET status = 'PUBLISHED', published_at = NOW(), locked_at = NULL, last_error = NULL, updated_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  async markFailed(client, id, error) {
    await client.query(
      `UPDATE outbox_events
          SET status = 'FAILED',
              attempts = attempts + 1,
              locked_at = NULL,
              last_error = $2,
              next_attempt_at = NOW() + (LEAST(3600, $3 * POWER(2, attempts)) || ' seconds')::interval,
              updated_at = NOW()
        WHERE id = $1`,
      [id, String(error?.message || error || 'publish failed').slice(0, 4000), this.config.baseBackoffSeconds]
    );
  }

  async publishPending({ limit, maxAttempts } = {}) {
    const batchLimit = Number(limit || this.config.batchSize);
    const max = Number(maxAttempts || this.config.maxAttempts);
    const client = await this.pg.connect();
    const stats = { claimed: 0, published: 0, failed: 0, scanIds: [] };
    try {
      await client.query('BEGIN');
      const rows = await this.claimPending(client, { limit: batchLimit, maxAttempts: max });
      stats.claimed = rows.length;
      await client.query('COMMIT');

      for (const row of rows) {
        const rowClient = await this.pg.connect();
        try {
          await rowClient.query('BEGIN');
          if (!this.serviceBus || typeof this.serviceBus.sendScanRequested !== 'function') throw new AppError('Service Bus publisher is not configured.', { code: 'SERVICEBUS_PUBLISHER_MISSING', statusCode: 500 });
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          await this.serviceBus.sendScanRequested(payload);
          await this.markPublished(rowClient, row.id);
          await rowClient.query('COMMIT');
          stats.published += 1;
          stats.scanIds.push(payload.scanId || row.aggregate_id);
        } catch (error) {
          try {
            await rowClient.query('ROLLBACK');
            await rowClient.query('BEGIN');
            await this.markFailed(rowClient, row.id, error);
            await rowClient.query('COMMIT');
          } catch (markError) {
            this.logger?.error?.({ err: markError, outboxId: row.id }, 'Unable to mark outbox failure.');
          }
          this.logger?.error?.({ err: error, outboxId: row.id }, 'Outbox publish failed.');
          stats.failed += 1;
        } finally {
          rowClient.release();
        }
      }
      return stats;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { OutboxService, outboxConfig };
