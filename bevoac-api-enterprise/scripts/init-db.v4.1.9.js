if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}
const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

const ALLOWED_PLAN_CODES = ['free', 'standard', 'business', 'payg'];

const CRITICAL_TABLES = [
  'tenants',
  'api_keys',
  'tenant_azure_scopes',
  'tenant_azure_integrations',
  'azure_onboarding_sessions',
  'tenant_web_targets',
  'scans',
  'billing_usage_ledger',
  'billing_monthly_snapshots',
  'scan_request_idempotency',
  'admin_audit_log'
];

const REQUIRED_PLAN_CONSTRAINTS = [
  { name: 'valid_plan_code', table: 'tenants', column: 'plan_code' },
  { name: 'valid_ledger_plan_code', table: 'billing_usage_ledger', column: 'plan_code_snapshot' },
  { name: 'valid_snapshot_plan', table: 'billing_monthly_snapshots', column: 'plan_code_snapshot' }
];

function formatSqlStringList(values) {
  return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(', ');
}

async function assertNoInvalidPlanCodes(client, tableName, columnName) {
  const allowed = formatSqlStringList(ALLOWED_PLAN_CODES);
  const result = await client.query(`
    SELECT ${columnName} AS value, COUNT(*)::int AS count
    FROM ${tableName}
    WHERE ${columnName} IS NOT NULL
      AND ${columnName} NOT IN (${allowed})
    GROUP BY ${columnName}
    ORDER BY ${columnName};
  `);

  if (result.rows.length > 0) {
    const invalidValues = result.rows.map((row) => `${row.value} (${row.count})`).join(', ');
    throw new Error([
      `Invalid plan values found in ${tableName}.${columnName}: ${invalidValues}.`,
      `Allowed plans are: ${ALLOWED_PLAN_CODES.join(', ')}.`,
      'Refusing to apply constraints automatically. Migrate or remove legacy values before retrying.'
    ].join(' '));
  }
}

async function rebuildPlanConstraints(client) {
  for (const item of REQUIRED_PLAN_CONSTRAINTS) {
    await assertNoInvalidPlanCodes(client, item.table, item.column);
  }

  await client.query(`
    ALTER TABLE tenants
    DROP CONSTRAINT IF EXISTS valid_plan_code;

    ALTER TABLE tenants
    ADD CONSTRAINT valid_plan_code
    CHECK (plan_code IN ('free', 'standard', 'business', 'payg'));

    ALTER TABLE billing_usage_ledger
    DROP CONSTRAINT IF EXISTS valid_ledger_plan_code;

    ALTER TABLE billing_usage_ledger
    ADD CONSTRAINT valid_ledger_plan_code
    CHECK (plan_code_snapshot IN ('free', 'standard', 'business', 'payg'));

    ALTER TABLE billing_monthly_snapshots
    DROP CONSTRAINT IF EXISTS valid_snapshot_plan;

    ALTER TABLE billing_monthly_snapshots
    ADD CONSTRAINT valid_snapshot_plan
    CHECK (plan_code_snapshot IN ('free', 'standard', 'business', 'payg'));
  `);
}

async function assertCriticalTablesExist(client) {
  const result = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name = ANY($1::text[])
      ORDER BY table_name;
    `,
    [CRITICAL_TABLES]
  );

  const existing = new Set(result.rows.map((row) => row.table_name));
  const missing = CRITICAL_TABLES.filter((table) => !existing.has(table));

  if (missing.length > 0) {
    throw new Error(`Database schema verification failed. Missing critical tables: ${missing.join(', ')}`);
  }
}

async function assertPlanConstraints(client) {
  const result = await client.query(
    `
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = ANY($1::text[])
      ORDER BY conname;
    `,
    [REQUIRED_PLAN_CONSTRAINTS.map((item) => item.name)]
  );

  const byName = new Map(result.rows.map((row) => [row.conname, row.definition]));
  const missing = REQUIRED_PLAN_CONSTRAINTS
    .filter((item) => !byName.has(item.name))
    .map((item) => item.name);

  if (missing.length > 0) {
    throw new Error(`Database schema verification failed. Missing plan constraints: ${missing.join(', ')}`);
  }

  for (const item of REQUIRED_PLAN_CONSTRAINTS) {
    const definition = String(byName.get(item.name) || '');

    for (const planCode of ALLOWED_PLAN_CODES) {
      if (!definition.includes(planCode)) {
        throw new Error(`Database schema verification failed. Constraint ${item.name} does not include required plan '${planCode}'. Definition: ${definition}`);
      }
    }

    if (definition.includes('starter')) {
      throw new Error(`Database schema verification failed. Constraint ${item.name} still contains obsolete plan 'starter'. Definition: ${definition}`);
    }
  }
}

async function assertSchemaIsReady(client) {
  await assertCriticalTablesExist(client);
  await assertPlanConstraints(client);
}

async function main() {
  const db = getDatabaseConfig();
  const client = new Client({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, ssl: db.ssl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '180s'");

    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    } catch (error) {
      if (error && error.code === '0A000') {
        console.error('pgcrypto is not allow-listed on this Azure PostgreSQL server. Allow it via azure.extensions or Terraform before retrying.');
      }
      throw error;
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_name VARCHAR(255) NOT NULL,
        external_customer_ref VARCHAR(100),
        plan_code VARCHAR(20) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT valid_plan_code CHECK (plan_code IN ('free', 'standard', 'business', 'payg'))
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        key_hash VARCHAR(255) UNIQUE NOT NULL,
        label VARCHAR(120),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP,
        last_used_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tenant_azure_scopes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        microsoft_tenant_id UUID NOT NULL,
        subscription_id UUID,
        display_name VARCHAR(255),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        source VARCHAR(50) NOT NULL DEFAULT 'manual_admin_verified',
        status VARCHAR(30) NOT NULL DEFAULT 'VERIFIED',
        verified_at TIMESTAMP,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT valid_tenant_azure_scope_source CHECK (source IN ('manual_admin_verified','admin_consent','lighthouse')),
        CONSTRAINT valid_tenant_azure_scope_status CHECK (status IN ('CONSENTED','VERIFIED','NEEDS_RBAC','STALE','DISABLED'))
      );

      CREATE TABLE IF NOT EXISTS tenant_azure_integrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        microsoft_tenant_id UUID NOT NULL,
        consent_status VARCHAR(30) NOT NULL DEFAULT 'STARTED',
        consented_at TIMESTAMP,
        last_verified_at TIMESTAMP,
        subscription_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_tenant_azure_integrations UNIQUE (tenant_id, microsoft_tenant_id),
        CONSTRAINT valid_tenant_azure_integration_status CHECK (consent_status IN ('STARTED','CONSENTED','ACTIVE','NEEDS_RBAC','FAILED','DISABLED'))
      );

      CREATE TABLE IF NOT EXISTS azure_onboarding_sessions (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
        state_hash VARCHAR(64) UNIQUE NOT NULL,
        nonce_hash VARCHAR(64) NOT NULL,
        redirect_uri TEXT NOT NULL,
        microsoft_tenant_id UUID,
        admin_consent BOOLEAN NOT NULL DEFAULT FALSE,
        status VARCHAR(30) NOT NULL DEFAULT 'STARTED',
        subscription_count INTEGER NOT NULL DEFAULT 0,
        error_code VARCHAR(120),
        error_description TEXT,
        expires_at TIMESTAMP NOT NULL,
        completed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT valid_azure_onboarding_session_status CHECK (status IN ('STARTED','VERIFYING','COMPLETED','ACTION_REQUIRED','FAILED','EXPIRED'))
      );

      CREATE TABLE IF NOT EXISTS tenant_web_targets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        host VARCHAR(255) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS scans (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        cloud_provider VARCHAR(20) NOT NULL,
        scan_profile VARCHAR(20) NOT NULL,
        modules JSONB NOT NULL DEFAULT '[]'::jsonb,
        target_url TEXT,
        microsoft_tenant_id VARCHAR(100),
        subscriptions JSONB NOT NULL DEFAULT '[]'::jsonb,
        billing_units INTEGER NOT NULL DEFAULT 1,
        is_quota_included BOOLEAN NOT NULL DEFAULT TRUE,
        quota_month DATE NOT NULL,
        resource_count INTEGER,
        resource_limit INTEGER,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        result JSONB,
        error_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP,
        CONSTRAINT valid_scan_status CHECK (status IN ('PENDING', 'IN_PROGRESS', 'DONE', 'FAILED')),
        CONSTRAINT valid_scan_profile CHECK (scan_profile IN ('web', 'entra', 'infra', 'full')),
        CONSTRAINT valid_cloud_provider CHECK (cloud_provider IN ('azure')),
        CONSTRAINT valid_billing_units CHECK (billing_units >= 1)
      );

      CREATE TABLE IF NOT EXISTS billing_usage_ledger (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        scan_id UUID REFERENCES scans(id) ON DELETE SET NULL,
        event_type VARCHAR(50) NOT NULL,
        plan_code_snapshot VARCHAR(20) NOT NULL,
        quota_month DATE NOT NULL,
        billing_units INTEGER NOT NULL DEFAULT 1,
        unit_price_eur_ht NUMERIC(10,2) NOT NULL DEFAULT 0,
        amount_eur_ht NUMERIC(10,2) NOT NULL DEFAULT 0,
        currency_code VARCHAR(3) NOT NULL DEFAULT 'EUR',
        cloud_provider VARCHAR(20),
        scan_profile VARCHAR(20),
        modules JSONB NOT NULL DEFAULT '[]'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT valid_ledger_event_type CHECK (event_type IN ('scan_included','scan_payg','scan_blocked_quota','adjustment','credit')),
        CONSTRAINT valid_ledger_plan_code CHECK (plan_code_snapshot IN ('free', 'standard', 'business', 'payg')),
        CONSTRAINT valid_ledger_currency CHECK (currency_code = 'EUR')
      );

      CREATE TABLE IF NOT EXISTS billing_monthly_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        quota_month DATE NOT NULL,
        plan_code_snapshot VARCHAR(20) NOT NULL,
        quota_limit INTEGER,
        resource_limit INTEGER,
        included_units_used INTEGER NOT NULL DEFAULT 0,
        payg_units_used INTEGER NOT NULL DEFAULT 0,
        payg_unit_price_eur_ht NUMERIC(10,2) NOT NULL DEFAULT 0,
        payg_amount_eur_ht NUMERIC(10,2) NOT NULL DEFAULT 0,
        adjustments_amount_eur_ht NUMERIC(10,2) NOT NULL DEFAULT 0,
        credits_amount_eur_ht NUMERIC(10,2) NOT NULL DEFAULT 0,
        total_amount_eur_ht NUMERIC(10,2) NOT NULL DEFAULT 0,
        currency_code VARCHAR(3) NOT NULL DEFAULT 'EUR',
        snapshot_status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMP,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT uq_snapshot_tenant_month UNIQUE (tenant_id, quota_month),
        CONSTRAINT valid_snapshot_status CHECK (snapshot_status IN ('OPEN', 'CLOSED')),
        CONSTRAINT valid_snapshot_plan CHECK (plan_code_snapshot IN ('free', 'standard', 'business', 'payg'))
      );

      CREATE TABLE IF NOT EXISTS scan_request_idempotency (
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        idempotency_key VARCHAR(255) NOT NULL,
        scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, idempotency_key)
      );

      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor VARCHAR(255) NOT NULL,
        action VARCHAR(255) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      ALTER TABLE scans ADD COLUMN IF NOT EXISTS resource_count INTEGER;
      ALTER TABLE scans ADD COLUMN IF NOT EXISTS resource_limit INTEGER;
      ALTER TABLE billing_monthly_snapshots ADD COLUMN IF NOT EXISTS resource_limit INTEGER;
      ALTER TABLE tenant_azure_scopes ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
      ALTER TABLE tenant_azure_scopes ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'manual_admin_verified';
      ALTER TABLE tenant_azure_scopes ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'VERIFIED';
      ALTER TABLE tenant_azure_scopes ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;
      ALTER TABLE tenant_azure_scopes ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_azure_tenant_scope ON tenant_azure_scopes (tenant_id, microsoft_tenant_id) WHERE subscription_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_azure_subscription_scope ON tenant_azure_scopes (tenant_id, microsoft_tenant_id, subscription_id) WHERE subscription_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_tenant_azure_scopes_tenant ON tenant_azure_scopes (tenant_id, microsoft_tenant_id, subscription_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_azure_scopes_status ON tenant_azure_scopes (tenant_id, is_active, status);
      CREATE INDEX IF NOT EXISTS idx_azure_onboarding_sessions_tenant ON azure_onboarding_sessions (tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tenant_azure_integrations_tenant ON tenant_azure_integrations (tenant_id, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_web_targets_host ON tenant_web_targets (tenant_id, host);
      CREATE INDEX IF NOT EXISTS idx_scans_tenant_created ON scans (tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scans_quota_month ON scans (tenant_id, quota_month);
      CREATE INDEX IF NOT EXISTS idx_scans_status ON scans (status);
      CREATE INDEX IF NOT EXISTS idx_ledger_tenant_month ON billing_usage_ledger (tenant_id, quota_month, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_snapshot_tenant_month ON billing_monthly_snapshots (tenant_id, quota_month DESC);
    `);

    await rebuildPlanConstraints(client);
    await assertSchemaIsReady(client);

    await client.query('COMMIT');

    console.log('Database schema initialized successfully.');
    console.log(`Verified critical tables: ${CRITICAL_TABLES.length}`);
    console.log(`Verified plan constraints: ${REQUIRED_PLAN_CONSTRAINTS.map((item) => item.name).join(', ')}`);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // Keep the original error. Rollback errors are secondary.
    }

    console.error('Database schema initialization failed. Transaction rolled back.');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
