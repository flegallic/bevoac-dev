CREATE INDEX IF NOT EXISTS idx_retention_scans_done_failed
  ON scans (status, completed_at)
  WHERE status IN ('DONE','FAILED');

CREATE INDEX IF NOT EXISTS idx_scan_request_idempotency_created
  ON scan_request_idempotency (created_at);

CREATE INDEX IF NOT EXISTS idx_azure_onboarding_sessions_created_status
  ON azure_onboarding_sessions (created_at, status);
