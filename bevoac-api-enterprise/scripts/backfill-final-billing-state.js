#!/usr/bin/env node
'use strict';

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const { Client } = require('pg');
const { getDatabaseConfig, optionalNumber } = require('../src/config/env');
const { BillingService } = require('../src/services/billing-service');

const DEFAULT_LIMIT = 100;
const FINAL_STATES = {
  DONE: { billingState: 'CONSUMED', eventType: 'scan_consumed', reason: 'historical_done_reserved' },
  FAILED: { billingState: 'REFUNDED', eventType: 'scan_refunded', reason: 'historical_failed_reserved' }
};

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    apply: false,
    includeFailed: false,
    tenantId: null,
    scanId: null,
    before: null,
    limit: DEFAULT_LIMIT
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--dry-run') out.apply = false;
    else if (arg === '--include-failed') out.includeFailed = true;
    else if (arg === '--tenant-id') out.tenantId = argv[++i] || null;
    else if (arg === '--scan-id') out.scanId = argv[++i] || null;
    else if (arg === '--before') out.before = argv[++i] || null;
    else if (arg === '--limit') out.limit = Number(argv[++i] || DEFAULT_LIMIT);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unsupported argument: ${arg}`);
  }

  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 1000) {
    throw new Error('--limit must be an integer between 1 and 1000.');
  }

  if (out.before) {
    const d = new Date(out.before);
    if (Number.isNaN(d.getTime())) throw new Error('--before must be a valid ISO date or timestamp.');
    out.before = d.toISOString();
  }

  return out;
}

function printHelp() {
  console.log(`Usage:
  node scripts/backfill-final-billing-state.js [--dry-run] [--apply] [options]

Purpose:
  Safely backfill historical scans that are status DONE but still billing_state RESERVED.
  Default mode is dry-run. No database changes are made unless --apply is provided.

Options:
  --apply             Apply changes. Without this flag, the script only reports candidates.
  --dry-run           Force dry-run mode. This is the default.
  --include-failed    Also backfill FAILED + RESERVED scans to REFUNDED.
  --tenant-id <uuid>  Restrict to one Bevoac tenant.
  --scan-id <uuid>    Restrict to one scan.
  --before <date>     Only include scans completed before this date/timestamp.
  --limit <n>         Max candidates to process. Default ${DEFAULT_LIMIT}, max 1000.

Examples:
  npm run backfill:billing:dry-run
  npm run backfill:billing -- --apply --before 2026-06-01
  npm run backfill:billing -- --apply --scan-id <scan_uuid>
`);
}

function minimalBillingConfig() {
  return {
    planQuotas: {
      free: optionalNumber('DEFAULT_PLAN_FREE_QUOTA', 30),
      standard: optionalNumber('DEFAULT_PLAN_STANDARD_QUOTA', 2500),
      business: optionalNumber('DEFAULT_PLAN_BUSINESS_QUOTA', 10000)
    },
    planResourceLimits: {
      free: optionalNumber('DEFAULT_PLAN_FREE_RESOURCE_LIMIT', 10),
      standard: optionalNumber('DEFAULT_PLAN_STANDARD_RESOURCE_LIMIT', 500),
      business: optionalNumber('DEFAULT_PLAN_BUSINESS_RESOURCE_LIMIT', 2500),
      payg: process.env.DEFAULT_PLAN_PAYG_RESOURCE_LIMIT ? optionalNumber('DEFAULT_PLAN_PAYG_RESOURCE_LIMIT', null) : null
    },
    paygUnitPriceEur: optionalNumber('PAYG_UNIT_PRICE_EUR', 0.10),
    backpressure: { activeScanLimits: {} }
  };
}

function finalStateForScanStatus(scanStatus, includeFailed = false) {
  const status = String(scanStatus || '').toUpperCase();
  if (status === 'DONE') return FINAL_STATES.DONE;
  if (status === 'FAILED' && includeFailed) return FINAL_STATES.FAILED;
  return null;
}

function amountForScan(row, plan) {
  if (row.is_quota_included === true) return { unitPrice: 0, amount: 0 };
  const unitPrice = Number(plan?.unitPriceEur || 0);
  const units = Number(row.billing_units || 1);
  return { unitPrice, amount: Number((unitPrice * units).toFixed(2)) };
}

async function findCandidates(client, opts) {
  const params = [];
  const where = ["s.billing_state = 'RESERVED'", 's.completed_at IS NOT NULL'];
  const statuses = opts.includeFailed ? ["'DONE'", "'FAILED'"] : ["'DONE'"];
  where.push(`s.status IN (${statuses.join(', ')})`);
  if (opts.tenantId) { params.push(opts.tenantId); where.push(`s.tenant_id = $${params.length}`); }
  if (opts.scanId) { params.push(opts.scanId); where.push(`s.id = $${params.length}`); }
  if (opts.before) { params.push(opts.before); where.push(`s.completed_at < $${params.length}::timestamptz`); }
  params.push(opts.limit);

  const sql = `
    SELECT
      s.id,
      s.tenant_id,
      s.status,
      s.billing_state,
      s.cloud_provider,
      s.scan_profile,
      s.modules,
      s.quota_month,
      s.billing_units,
      s.is_quota_included,
      s.created_at,
      s.completed_at,
      t.plan_code
    FROM scans s
    INNER JOIN tenants t ON t.id = s.tenant_id
    WHERE ${where.join(' AND ')}
      AND NOT EXISTS (
        SELECT 1
        FROM billing_usage_ledger l
        WHERE l.scan_id = s.id
          AND l.event_type IN ('scan_consumed', 'scan_refunded')
      )
    ORDER BY s.completed_at ASC, s.created_at ASC
    LIMIT $${params.length}
  `;

  const result = await client.query(sql, params);
  return result.rows;
}

async function applyCandidate(client, billingService, row, opts) {
  const target = finalStateForScanStatus(row.status, opts.includeFailed);
  if (!target) return { scanId: row.id, skipped: true, reason: 'unsupported_scan_status' };
  const plan = billingService.getPlanDefinition(row.plan_code);
  const money = amountForScan(row, plan);
  const metadata = {
    source: 'v6.1-final-billing-state-backfill',
    reason: target.reason,
    previousBillingState: row.billing_state,
    finalBillingState: target.billingState,
    completedAt: row.completed_at,
    dryRun: false
  };

  await client.query('BEGIN');
  try {
    const updated = await client.query(
      `UPDATE scans
       SET billing_state = $2::varchar,
           billing_state_updated_at = NOW(),
           billing_error = NULL,
           updated_at = NOW()
       WHERE id = $1::uuid
         AND billing_state = 'RESERVED'
         AND status = $3::varchar
       RETURNING id`,
      [row.id, target.billingState, row.status]
    );

    if (updated.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { scanId: row.id, skipped: true, reason: 'not_updated_concurrently_changed' };
    }

    await client.query(
      `INSERT INTO billing_usage_ledger (
        tenant_id, scan_id, event_type, plan_code_snapshot, quota_month, billing_units,
        unit_price_eur_ht, amount_eur_ht, currency_code, cloud_provider, scan_profile,
        modules, metadata, recorded_at
      )
      SELECT $1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::date, $6::integer, $7::numeric, $8::numeric,
             'EUR', $9::varchar, $10::varchar, $11::jsonb, $12::jsonb, NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM billing_usage_ledger
        WHERE scan_id = $2::uuid AND event_type = $3::varchar
      )`,
      [
        row.tenant_id,
        row.id,
        target.eventType,
        row.plan_code,
        row.quota_month,
        Number(row.billing_units || 1),
        money.unitPrice,
        target.eventType === 'scan_refunded' ? -Math.abs(money.amount) : money.amount,
        row.cloud_provider,
        row.scan_profile,
        JSON.stringify(row.modules || []),
        JSON.stringify(metadata)
      ]
    );

    await billingService.upsertSnapshot(client, row.tenant_id, row.quota_month);
    await client.query('COMMIT');
    return { scanId: row.id, applied: true, finalBillingState: target.billingState, eventType: target.eventType };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const opts = parseArgs();
  if (opts.help) { printHelp(); return; }
  const db = getDatabaseConfig();
  const client = new Client({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, ssl: db.ssl });
  const billingService = new BillingService(null, minimalBillingConfig());
  await client.connect();

  try {
    const candidates = await findCandidates(client, opts);
    console.log(JSON.stringify({ mode: opts.apply ? 'apply' : 'dry-run', candidates: candidates.length, includeFailed: opts.includeFailed, limit: opts.limit }, null, 2));
    for (const row of candidates) {
      const target = finalStateForScanStatus(row.status, opts.includeFailed);
      const summary = {
        scanId: row.id,
        tenantId: row.tenant_id,
        status: row.status,
        currentBillingState: row.billing_state,
        targetBillingState: target?.billingState || null,
        targetLedgerEvent: target?.eventType || null,
        planCode: row.plan_code,
        quotaMonth: row.quota_month,
        billingUnits: Number(row.billing_units || 1),
        isQuotaIncluded: row.is_quota_included,
        completedAt: row.completed_at
      };
      if (!opts.apply) {
        console.log(`[DRY-RUN] ${JSON.stringify(summary)}`);
        continue;
      }
      const applied = await applyCandidate(client, billingService, row, opts);
      console.log(`[APPLY] ${JSON.stringify({ ...summary, ...applied })}`);
    }
    if (!opts.apply) console.log('Dry-run only. Re-run with --apply to modify billing states and ledger.');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = {
  parseArgs,
  finalStateForScanStatus,
  amountForScan,
  findCandidates,
  applyCandidate,
  minimalBillingConfig
};
