-- Bevoac V6.2 prerequisite migration.
-- Creates scan execution storage before tenant isolation guardrails.
-- Must run after the initial outbox/billing migrations and before
-- 202606010001_tenant_isolation_guardrails.sql.

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
  CONSTRAINT valid_scan_results_compression
    CHECK (compression IN ('none', 'gzip_base64')),
  CONSTRAINT valid_scan_results_payload
    CHECK (
      (compression = 'none' AND result_json IS NOT NULL)
      OR
      (compression = 'gzip_base64' AND result_gzip_base64 IS NOT NULL)
    )
);

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
  CONSTRAINT valid_scan_attempt_status
    CHECK (status IN ('STARTED', 'COMPLETED', 'FAILED', 'SKIPPED'))
);
