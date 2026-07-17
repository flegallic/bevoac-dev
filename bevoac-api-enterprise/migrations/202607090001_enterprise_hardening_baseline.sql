-- Bevoac V6.1.2 enterprise hardening baseline.
-- Safe to run through scripts/migrate-db.js. Designed to repair baseline/runtime drift.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT '["scan:create","scan:read","scan:result:read","scan:pdf:read","billing:read","onboarding:read","onboarding:write"]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_api_key_scopes_json') THEN
    ALTER TABLE api_keys ADD CONSTRAINT valid_api_key_scopes_json CHECK (jsonb_typeof(scopes) = 'array');
  END IF;
END $$;

ALTER TABLE scans ADD COLUMN IF NOT EXISTS billing_state VARCHAR(20) NOT NULL DEFAULT 'RESERVED';
ALTER TABLE scans ADD COLUMN IF NOT EXISTS billing_error TEXT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS billing_state_updated_at TIMESTAMP;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS processing_attempt_id UUID;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS result_size_bytes INTEGER;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS result_sha256 VARCHAR(64);
ALTER TABLE scans ADD COLUMN IF NOT EXISTS resource_count INTEGER;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS resource_limit INTEGER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_cloud_provider') THEN
    ALTER TABLE scans DROP CONSTRAINT valid_cloud_provider;
  END IF;
  ALTER TABLE scans ADD CONSTRAINT valid_cloud_provider CHECK (cloud_provider IN ('azure','aws'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_billing_state') THEN
    ALTER TABLE scans ADD CONSTRAINT valid_billing_state CHECK (billing_state IN ('RESERVED','CONSUMED','REFUNDED','ERROR'));
  END IF;
END $$;

ALTER TABLE scan_request_idempotency ADD COLUMN IF NOT EXISTS idempotency_key_source VARCHAR(30) NOT NULL DEFAULT 'client_supplied';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_idempotency_key_source') THEN
    ALTER TABLE scan_request_idempotency ADD CONSTRAINT valid_idempotency_key_source CHECK (idempotency_key_source IN ('client_supplied','server_generated'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_ledger_event_type') THEN
    ALTER TABLE billing_usage_ledger DROP CONSTRAINT valid_ledger_event_type;
  END IF;
  ALTER TABLE billing_usage_ledger ADD CONSTRAINT valid_ledger_event_type CHECK (event_type IN ('scan_included','scan_payg','scan_blocked_quota','adjustment','credit','scan_reserved','scan_consumed','scan_refunded'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS scan_results (
  scan_id UUID PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  result_json JSONB,
  result_gzip_base64 TEXT,
  compression VARCHAR(20) NOT NULL DEFAULT 'none',
  result_size_bytes INTEGER,
  result_sha256 VARCHAR(64),
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_scan_results_compression CHECK (compression IN ('none','gzip_base64')),
  CONSTRAINT valid_scan_results_payload CHECK ((compression = 'none' AND result_json IS NOT NULL) OR (compression = 'gzip_base64' AND result_gzip_base64 IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_scan_results_tenant ON scan_results (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS scan_attempts (
  attempt_id UUID PRIMARY KEY,
  scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  worker_name VARCHAR(255),
  servicebus_message_id VARCHAR(255),
  servicebus_delivery_count INTEGER,
  status VARCHAR(30) NOT NULL,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  CONSTRAINT valid_scan_attempt_status CHECK (status IN ('STARTED','COMPLETED','FAILED','SKIPPED'))
);

CREATE INDEX IF NOT EXISTS idx_scan_attempts_scan ON scan_attempts (tenant_id, scan_id, started_at DESC);

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(80) NOT NULL,
  aggregate_id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type VARCHAR(120) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP,
  locked_at TIMESTAMP,
  last_error TEXT,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_outbox_status CHECK (status IN ('PENDING','PROCESSING','FAILED','PUBLISHED')),
  CONSTRAINT uq_outbox_event_aggregate UNIQUE (event_type, aggregate_id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_tenant ON outbox_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_active ON api_keys (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_scans_tenant_status ON scans (tenant_id, status, created_at DESC);
