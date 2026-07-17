CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE scan_request_idempotency
  ADD COLUMN IF NOT EXISTS idempotency_key_source VARCHAR(30) NOT NULL DEFAULT 'client_supplied';

ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS billing_state VARCHAR(30) NOT NULL DEFAULT 'RESERVED';

ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS billing_state_updated_at TIMESTAMP;

ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS billing_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_scan_billing_state') THEN
    ALTER TABLE scans
      ADD CONSTRAINT valid_scan_billing_state
      CHECK (billing_state IN ('RESERVED','CONSUMED','REFUNDED','NOT_BILLABLE'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(80) NOT NULL,
  aggregate_id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type VARCHAR(120) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMP,
  published_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_outbox_status CHECK (status IN ('PENDING','PROCESSING','PUBLISHED','FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_event_aggregate ON outbox_events (event_type, aggregate_id);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON outbox_events (status, next_attempt_at, created_at)
  WHERE status IN ('PENDING','FAILED');

CREATE INDEX IF NOT EXISTS idx_outbox_tenant_created ON outbox_events (tenant_id, created_at DESC);

ALTER TABLE billing_usage_ledger DROP CONSTRAINT IF EXISTS valid_ledger_event_type;

ALTER TABLE billing_usage_ledger
  ADD CONSTRAINT valid_ledger_event_type CHECK (
    event_type IN (
      'scan_reserved',
      'scan_consumed',
      'scan_refunded',
      'scan_included',
      'scan_payg',
      'scan_blocked_quota',
      'adjustment',
      'credit'
    )
  );

CREATE INDEX IF NOT EXISTS idx_billing_ledger_scan_event
  ON billing_usage_ledger (scan_id, event_type, recorded_at DESC);
