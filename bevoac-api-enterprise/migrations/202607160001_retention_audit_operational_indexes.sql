-- Bevoac V6.1.2 enterprise operational schema completion.
-- Adds the retention audit table required by retention-sweep.js and
-- operational indexes not already covered by previous migrations.

CREATE TABLE IF NOT EXISTS retention_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(120) NOT NULL,
  affected_rows INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scans_quota_status
  ON scans (tenant_id, quota_month, status);

CREATE INDEX IF NOT EXISTS idx_scan_results_summary_gin
  ON scan_results USING GIN (result_summary);

CREATE INDEX IF NOT EXISTS idx_scan_attempts_scan_started
  ON scan_attempts (scan_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_idempotency_created
  ON scan_request_idempotency (created_at);

CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_expires
  ON azure_onboarding_sessions (expires_at, status);
