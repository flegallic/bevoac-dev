if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}
const { Client } = require('pg');
const { getDatabaseConfig } = require('../src/config/env');

async function main() {
  const db = getDatabaseConfig();
  const client = new Client({ host: db.host, port: db.port, database: db.database, user: db.user, password: db.password, ssl: db.ssl });
  await client.connect();
  try {
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
        request_fingerprint CHAR(64),
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
      ALTER TABLE scans ADD COLUMN IF NOT EXISTS error_code VARCHAR(120);
      ALTER TABLE scans ADD COLUMN IF NOT EXISTS error_correlation_id UUID;
      ALTER TABLE scan_request_idempotency ADD COLUMN IF NOT EXISTS request_fingerprint CHAR(64);
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
    console.log('Database schema initialized successfully.');
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
