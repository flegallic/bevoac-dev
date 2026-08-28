#!/usr/bin/env node
'use strict';

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const { Client } = require('pg');
const { getConfig } = require('../src/config/env');

function numberFromEnv(env, name, fallback) {
  const value = env[name];
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number.`);
  return parsed;
}

function planRetentionDays(env = process.env, config = {}) {
  const legacyDone = Number(config?.retention?.scanResultRetentionDays || 180);
  return {
    free: numberFromEnv(env, 'SCAN_RESULT_RETENTION_DAYS_FREE', 30),
    standard: numberFromEnv(env, 'SCAN_RESULT_RETENTION_DAYS_STANDARD', 90),
    business: numberFromEnv(env, 'SCAN_RESULT_RETENTION_DAYS_BUSINESS', 180),
    payg: numberFromEnv(env, 'SCAN_RESULT_RETENTION_DAYS_PAYG', 180),
    fallback: numberFromEnv(env, 'SCAN_RESULT_RETENTION_DAYS', legacyDone)
  };
}

function retentionCaseSql(tableAlias = 't') {
  return `CASE lower(coalesce(${tableAlias}.plan_code, 'standard'))
    WHEN 'free' THEN $3::int
    WHEN 'standard' THEN $4::int
    WHEN 'business' THEN $5::int
    WHEN 'payg' THEN $6::int
    ELSE $7::int
  END`;
}

function retentionParams({ failedDays, days }) {
  return [failedDays, days.fallback, days.free, days.standard, days.business, days.payg, days.fallback];
}

async function countCandidates(client, { failedDays, days }) {
  const result = await client.query(
    `WITH candidates AS (
       SELECT
         s.status,
         lower(coalesce(t.plan_code, 'standard')) AS plan_code
       FROM scans s
       LEFT JOIN tenants t ON t.id = s.tenant_id
       WHERE (s.status = 'DONE' AND s.completed_at < NOW() - ((${retentionCaseSql('t')}) || ' days')::interval)
          OR (s.status = 'FAILED' AND s.completed_at < NOW() - ($1::int || ' days')::interval)
     )
     SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'DONE')::int AS done,
       COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
       COALESCE(
         (
           SELECT jsonb_object_agg(p.plan_code, p.count_by_plan)
           FROM (
             SELECT c.plan_code, COUNT(*)::int AS count_by_plan
             FROM candidates c
             WHERE c.status = 'DONE'
             GROUP BY c.plan_code
           ) p
         ),
         '{}'::jsonb
       ) AS done_by_plan
     FROM candidates`,
    retentionParams({ failedDays, days })
  );
  return result.rows[0] || { total: 0, done: 0, failed: 0, done_by_plan: {} };
}

async function deleteExpiredScans(client, { failedDays, days }) {
  const result = await client.query(
    `DELETE FROM scans s
      USING tenants t
      WHERE t.id = s.tenant_id
        AND (
          (s.status = 'DONE' AND s.completed_at < NOW() - ((${retentionCaseSql('t')}) || ' days')::interval)
          OR
          (s.status = 'FAILED' AND s.completed_at < NOW() - ($1::int || ' days')::interval)
        )`,
    retentionParams({ failedDays, days })
  );
  return result.rowCount || 0;
}

async function runRetentionSweep({ client, config, env = process.env }) {
  const dryRun = String(env.DRY_RUN || 'true').toLowerCase() !== 'false';
  const days = planRetentionDays(env, config);
  const failedDays = numberFromEnv(env, 'FAILED_SCAN_RETENTION_DAYS', Number(config.retention.failedScanRetentionDays || 90));
  const idempotencyDays = numberFromEnv(env, 'IDEMPOTENCY_RETENTION_DAYS', Number(config.retention.idempotencyRetentionDays || 30));
  const onboardingDays = numberFromEnv(env, 'ONBOARDING_SESSION_RETENTION_DAYS', Number(config.retention.onboardingSessionRetentionDays || 30));

  const candidates = await countCandidates(client, { failedDays, days });
  const summary = { dryRun, removableScans: Number(candidates.total || 0), removableDoneScans: Number(candidates.done || 0), removableFailedScans: Number(candidates.failed || 0), doneByPlan: candidates.done_by_plan || {}, retentionDays: days, failedDays, idempotencyDays, onboardingDays };

  if (dryRun) return summary;

  await client.query('BEGIN');
  try {
    const deletedScans = await deleteExpiredScans(client, { failedDays, days });
    const deletedIdempotency = await client.query(`DELETE FROM scan_request_idempotency WHERE created_at < NOW() - ($1::int || ' days')::interval`, [idempotencyDays]);
    const deletedSessions = await client.query(`DELETE FROM azure_onboarding_sessions WHERE created_at < NOW() - ($1::int || ' days')::interval AND status IN ('COMPLETED','FAILED','EXPIRED','ACTION_REQUIRED')`, [onboardingDays]);
    await client.query(
      `INSERT INTO retention_audit_log (action, affected_rows, metadata, created_at) VALUES ('retention.sweep.v6_1_1_plan_based', $1, $2::jsonb, NOW())`,
      [deletedScans, JSON.stringify({ deletedScans, deletedIdempotency: deletedIdempotency.rowCount || 0, deletedSessions: deletedSessions.rowCount || 0, retentionDays: days, failedDays, idempotencyDays, onboardingDays })]
    );
    await client.query('COMMIT');
    return { ...summary, deletedScans, deletedIdempotency: deletedIdempotency.rowCount || 0, deletedSessions: deletedSessions.rowCount || 0 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  const config = getConfig();
  const db = config.postgres;
  const client = new Client({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, ssl: db.ssl });
  await client.connect();
  try {
    const result = await runRetentionSweep({ client, config, env: process.env });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = {
  numberFromEnv,
  planRetentionDays,
  retentionCaseSql,
  retentionParams,
  countCandidates,
  deleteExpiredScans,
  runRetentionSweep
};
