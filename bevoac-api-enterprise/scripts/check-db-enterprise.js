#!/usr/bin/env node

require('dotenv').config();
const { Client } = require('pg');

const args = process.argv.slice(2);

function readArg(flag, fallback = null) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

const tenantFilter = readArg('--tenant');
const limit = Math.max(parseInt(readArg('--limit', '20'), 10) || 20, 1);
const verbose = args.includes('--verbose');

function section(title) {
  const bar = '═'.repeat(Math.max(title.length + 4, 28));
  console.log(`\n${bar}`);
  console.log(`  ${title}`);
  console.log(bar);
}

function fmtDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function fmtBool(value) {
  if (value === null || value === undefined) return '-';
  return value ? 'YES' : 'NO';
}

function n(value) {
  return Number(value || 0);
}

async function getColumns(client, tableName) {
  const { rows } = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    ORDER BY ordinal_position
    `,
    [tableName]
  );
  return new Set(rows.map((r) => r.column_name));
}

function has(cols, name) {
  return cols.has(name);
}

function normalizeJson(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'object') {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
}

function extractMicrosoftTenantId(row) {
  if (row.tenant_microsoft_tenant_id) return row.tenant_microsoft_tenant_id;

  const target = normalizeJson(row.last_scan_target);
  if (target && typeof target === 'object' && target.microsoftTenantId) {
    return target.microsoftTenantId;
  }

  if (row.last_scan_microsoft_tenant_id) return row.last_scan_microsoft_tenant_id;

  return '-';
}

function extractSubscriptions(row) {
  const target = normalizeJson(row.last_scan_target);
  if (target && typeof target === 'object' && Array.isArray(target.subscriptions) && target.subscriptions.length > 0) {
    return target.subscriptions.join(', ');
  }

  const raw = normalizeJson(row.last_scan_subscriptions);

  if (Array.isArray(raw)) {
    return raw.length ? raw.join(', ') : '-';
  }

  if (raw && typeof raw === 'object' && Array.isArray(raw.subscriptions)) {
    return raw.subscriptions.length ? raw.subscriptions.join(', ') : '-';
  }

  if (typeof raw === 'string' && raw.trim()) {
    return raw;
  }

  return '-';
}

function extractTargetUrl(row) {
  const target = normalizeJson(row.last_scan_target);
  if (target && typeof target === 'object' && target.targetUrl) {
    return target.targetUrl;
  }
  return '-';
}

async function main() {
  const client = new Client({
    host: process.env.PG_HOST,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE || 'postgres',
    port: Number(process.env.PG_PORT || 5432),
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected to PostgreSQL.');

  const tenantsCols = await getColumns(client, 'tenants');
  const apiKeysCols = await getColumns(client, 'api_keys');
  const scansCols = await getColumns(client, 'scans');
  const snapshotsCols = await getColumns(client, 'billing_monthly_snapshots');
  const ledgerCols = await getColumns(client, 'billing_usage_ledger');
  const integrationsCols = await getColumns(client, 'tenant_azure_integrations');
  const scopesCols = await getColumns(client, 'tenant_azure_scopes');
  const sessionsCols = await getColumns(client, 'azure_onboarding_sessions');

  const tableCountsSql = `
    SELECT
      ${has(tenantsCols, 'id') ? `(SELECT COUNT(*)::int FROM tenants)` : '0'} AS tenants,
      ${has(apiKeysCols, 'id') ? `(SELECT COUNT(*)::int FROM api_keys)` : '0'} AS api_keys,
      ${has(scansCols, 'id') ? `(SELECT COUNT(*)::int FROM scans)` : '0'} AS scans,
      ${has(ledgerCols, 'id') ? `(SELECT COUNT(*)::int FROM billing_usage_ledger)` : '0'} AS ledger_entries,
      ${has(snapshotsCols, 'tenant_id') ? `(SELECT COUNT(*)::int FROM billing_monthly_snapshots)` : '0'} AS snapshots,
      ${has(integrationsCols, 'tenant_id') ? `(SELECT COUNT(*)::int FROM tenant_azure_integrations)` : '0'} AS azure_integrations,
      ${has(scopesCols, 'tenant_id') ? `(SELECT COUNT(*)::int FROM tenant_azure_scopes)` : '0'} AS azure_scopes,
      ${has(sessionsCols, 'tenant_id') ? `(SELECT COUNT(*)::int FROM azure_onboarding_sessions)` : '0'} AS onboarding_sessions
  `;
  const { rows: countRows } = await client.query(tableCountsSql);
  const counts = countRows[0];

  section('Global overview');
  console.table([{
    tenants: counts.tenants,
    api_keys: counts.api_keys,
    scans: counts.scans,
    ledger_entries: counts.ledger_entries,
    snapshots: counts.snapshots,
    azure_integrations: counts.azure_integrations,
    azure_scopes: counts.azure_scopes,
    onboarding_sessions: counts.onboarding_sessions,
    quota_month: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10)
  }]);

  const whereTenant = tenantFilter ? `WHERE t.id = $1` : '';
  const queryParams = tenantFilter ? [tenantFilter, limit] : [limit];

  const tenantMicrosoftExpr = has(tenantsCols, 'microsoft_tenant_id')
    ? `t.microsoft_tenant_id`
    : `NULL`;

  const consentExpr = has(tenantsCols, 'entra_consent_granted')
    ? `t.entra_consent_granted`
    : `NULL`;

  const consentAtExpr = has(tenantsCols, 'entra_consent_granted_at')
    ? `t.entra_consent_granted_at`
    : `NULL`;

  const apiKeysActiveExpr = has(apiKeysCols, 'is_active')
    ? `COUNT(DISTINCT CASE WHEN ak.is_active = true THEN ak.id END)::int`
    : `COUNT(DISTINCT ak.id)::int`;

  const apiKeyLastUsedExpr = has(apiKeysCols, 'last_used_at')
    ? `MAX(ak.last_used_at)`
    : `NULL`;

  const latestScanTargetExpr = has(scansCols, 'target')
    ? `ls.target`
    : `NULL`;

  const latestScanSubscriptionsExpr = has(scansCols, 'subscriptions')
    ? `ls.subscriptions`
    : `NULL`;

  const latestScanTenantExpr = has(scansCols, 'microsoft_tenant_id')
    ? `ls.microsoft_tenant_id`
    : `NULL`;

  const planSnapshotExpr = has(snapshotsCols, 'plan_code_snapshot')
    ? `bs.plan_code_snapshot`
    : `t.plan_code`;

  const quotaLimitExpr = has(snapshotsCols, 'quota_limit')
    ? `bs.quota_limit`
    : `NULL`;

  const includedUsedExpr = has(snapshotsCols, 'included_units_used')
    ? `bs.included_units_used`
    : `NULL`;

  const paygUsedExpr = has(snapshotsCols, 'payg_units_used')
    ? `bs.payg_units_used`
    : `NULL`;

  const paygAmountExpr = has(snapshotsCols, 'payg_amount_eur_ht')
    ? `bs.payg_amount_eur_ht`
    : `NULL`;

  const snapshotStatusExpr = has(snapshotsCols, 'snapshot_status')
    ? `bs.snapshot_status`
    : `NULL`;

  const portfolioQuery = `
    WITH tenant_api_keys AS (
      SELECT
        ak.tenant_id,
        ${apiKeysActiveExpr} AS active_api_keys,
        ${apiKeyLastUsedExpr} AS last_api_key_use
      FROM api_keys ak
      GROUP BY ak.tenant_id
    ),
    tenant_scans AS (
      SELECT
        s.tenant_id,
        COUNT(*)::int AS total_scans,
        COUNT(*) FILTER (WHERE s.status = 'DONE')::int AS done_scans,
        COUNT(*) FILTER (WHERE s.status = 'FAILED')::int AS failed_scans,
        COUNT(*) FILTER (WHERE s.status = 'PENDING')::int AS pending_scans,
        MAX(s.created_at) AS last_scan_at
      FROM scans s
      GROUP BY s.tenant_id
    ),
    latest_scan AS (
      SELECT DISTINCT ON (s.tenant_id)
        s.*
      FROM scans s
      ORDER BY s.tenant_id, s.created_at DESC
    ),
    latest_snapshot AS (
      SELECT DISTINCT ON (bms.tenant_id)
        bms.*
      FROM billing_monthly_snapshots bms
      ORDER BY bms.tenant_id, bms.quota_month DESC, bms.generated_at DESC NULLS LAST
    )
    SELECT
      t.id AS tenant_id,
      t.company_name,
      t.plan_code,
      ${tenantMicrosoftExpr} AS tenant_microsoft_tenant_id,
      ${consentExpr} AS entra_consent_granted,
      ${consentAtExpr} AS entra_consent_granted_at,
      t.created_at,
      COALESCE(tak.active_api_keys, 0) AS active_api_keys,
      tak.last_api_key_use,
      COALESCE(ts.total_scans, 0) AS total_scans,
      COALESCE(ts.done_scans, 0) AS done_scans,
      COALESCE(ts.failed_scans, 0) AS failed_scans,
      COALESCE(ts.pending_scans, 0) AS pending_scans,
      ts.last_scan_at,
      ls.id AS last_scan_id,
      ls.status AS last_scan_status,
      ls.scan_profile AS last_scan_profile,
      ls.cloud_provider AS last_scan_cloud,
      ${latestScanTenantExpr} AS last_scan_microsoft_tenant_id,
      ${latestScanTargetExpr} AS last_scan_target,
      ${latestScanSubscriptionsExpr} AS last_scan_subscriptions,
      ${planSnapshotExpr} AS billing_plan,
      ${quotaLimitExpr} AS quota_limit,
      ${includedUsedExpr} AS included_units_used,
      ${paygUsedExpr} AS payg_units_used,
      ${paygAmountExpr} AS payg_amount_eur_ht,
      ${snapshotStatusExpr} AS snapshot_status
    FROM tenants t
    LEFT JOIN tenant_api_keys tak ON tak.tenant_id = t.id
    LEFT JOIN tenant_scans ts ON ts.tenant_id = t.id
    LEFT JOIN latest_scan ls ON ls.tenant_id = t.id
    LEFT JOIN latest_snapshot bs ON bs.tenant_id = t.id
    ${whereTenant}
    ORDER BY t.created_at DESC
    LIMIT $${tenantFilter ? 2 : 1}
  `;

  const { rows: portfolio } = await client.query(portfolioQuery, queryParams);

  section(tenantFilter ? `Client detail: ${tenantFilter}` : 'Client portfolio');
  if (!portfolio.length) {
    console.log('No client found.');
  } else {
    console.table(
      portfolio.map((row) => {
        const quotaLimit = row.quota_limit;
        const includedUsed = row.included_units_used;
        const scansRemaining =
          quotaLimit === null || quotaLimit === undefined || includedUsed === null || includedUsed === undefined
            ? '-'
            : Math.max(n(quotaLimit) - n(includedUsed), 0);

        return {
          company_name: row.company_name,
          tenant_id: row.tenant_id,
          plan_code: row.plan_code,
          billing_plan: row.billing_plan || row.plan_code || '-',
          microsoft_tenant_id: extractMicrosoftTenantId(row),
          subscriptions: extractSubscriptions(row),
          entra_consent: fmtBool(row.entra_consent_granted),
          active_api_keys: n(row.active_api_keys),
          total_scans: n(row.total_scans),
          done_scans: n(row.done_scans),
          failed_scans: n(row.failed_scans),
          pending_scans: n(row.pending_scans),
          quota_limit: quotaLimit ?? '-',
          included_used: includedUsed ?? '-',
          scans_remaining: scansRemaining,
          payg_used: row.payg_units_used ?? '-',
          payg_amount_eur_ht: row.payg_amount_eur_ht ?? '-',
          snapshot_status: row.snapshot_status || '-',
          last_scan_status: row.last_scan_status || '-',
          last_scan_profile: row.last_scan_profile || '-',
          created_at: fmtDate(row.created_at)
        };
      })
    );

    if (verbose) {
      section('Client detail (verbose)');
      portfolio.forEach((row) => {
        console.log(`- ${row.company_name} (${row.tenant_id})`);
        console.log(`  Plan                : ${row.plan_code || '-'}`);
        console.log(`  Billing plan        : ${row.billing_plan || row.plan_code || '-'}`);
        console.log(`  Microsoft tenant    : ${extractMicrosoftTenantId(row)}`);
        console.log(`  Subscriptions       : ${extractSubscriptions(row)}`);
        console.log(`  Entra consent       : ${fmtBool(row.entra_consent_granted)} / ${fmtDate(row.entra_consent_granted_at)}`);
        console.log(`  API keys actives    : ${n(row.active_api_keys)}`);
        console.log(`  Last API key use    : ${fmtDate(row.last_api_key_use)}`);
        console.log(`  Total scans         : ${n(row.total_scans)} (DONE=${n(row.done_scans)}, FAILED=${n(row.failed_scans)}, PENDING=${n(row.pending_scans)})`);
        console.log(`  Last scan           : ${row.last_scan_id || '-'} | ${row.last_scan_status || '-'} | ${row.last_scan_profile || '-'} | ${fmtDate(row.last_scan_at)}`);
        console.log(`  Last target URL     : ${extractTargetUrl(row)}`);
        console.log(`  Billing snapshot    : quota=${row.quota_limit ?? '-'} | included=${row.included_units_used ?? '-'} | payg=${row.payg_units_used ?? '-'} | amount=${row.payg_amount_eur_ht ?? '-'} | status=${row.snapshot_status || '-'}`);
      });
    }
  }

  const recentScansQuery = `
    SELECT
      s.id AS scan_id,
      t.company_name,
      s.cloud_provider,
      s.scan_profile,
      s.status,
      s.billing_units,
      s.is_quota_included,
      s.quota_month,
      s.created_at,
      s.completed_at,
      s.error_message
    FROM scans s
    INNER JOIN tenants t ON t.id = s.tenant_id
    ${tenantFilter ? 'WHERE s.tenant_id = $1' : ''}
    ORDER BY s.created_at DESC
    LIMIT $${tenantFilter ? 2 : 1}
  `;

  const { rows: recentScans } = await client.query(recentScansQuery, queryParams);

  section('Recent scans');
  if (!recentScans.length) {
    console.log('No scan found.');
  } else {
    console.table(
      recentScans.map((row) => ({
        scan_id: row.scan_id,
        company_name: row.company_name,
        cloud: row.cloud_provider,
        profile: row.scan_profile,
        status: row.status,
        units: row.billing_units,
        included: fmtBool(row.is_quota_included),
        quota_month: row.quota_month || '-',
        created_at: fmtDate(row.created_at),
        completed_at: fmtDate(row.completed_at)
      }))
    );
  }

  section('Operator notes');
  console.log('- Azure onboarding    : GET /v1/onboarding/azure/status with Authorization: Bearer <API_KEY>');
  console.log('- Client billing view : GET /v1/billing/overview with Authorization: Bearer <API_KEY>');
  console.log('- Admin billing view  : GET /v1/admin/billing/overview?month=YYYY-MM-01 with x-admin-secret');
  console.log('- Admin ledger        : GET /v1/admin/billing/tenants/<TENANT_ID>/ledger?month=YYYY-MM-01');
  console.log('- Month close         : POST /v1/admin/billing/close-month?month=YYYY-MM-01');

  await client.end();
}

main().catch((error) => {
  console.error('Database check failed:', error.message);
  if (verbose && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});