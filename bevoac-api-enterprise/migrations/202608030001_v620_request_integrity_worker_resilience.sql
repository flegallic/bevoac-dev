-- Bevoac V6.2.0: request integrity and retry-safe worker state.

ALTER TABLE scan_request_idempotency
  ADD COLUMN IF NOT EXISTS request_fingerprint CHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_idempotency_request_fingerprint'
  ) THEN
    ALTER TABLE scan_request_idempotency
      ADD CONSTRAINT valid_idempotency_request_fingerprint
      CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

ALTER TABLE scans ADD COLUMN IF NOT EXISTS error_code VARCHAR(120);
ALTER TABLE scans ADD COLUMN IF NOT EXISTS error_correlation_id UUID;

ALTER TABLE scan_attempts ADD COLUMN IF NOT EXISTS error_code VARCHAR(120);
ALTER TABLE scan_attempts ADD COLUMN IF NOT EXISTS error_correlation_id UUID;

ALTER TABLE scan_attempts DROP CONSTRAINT IF EXISTS valid_scan_attempt_status;
ALTER TABLE scan_attempts
  ADD CONSTRAINT valid_scan_attempt_status
  CHECK (status IN ('STARTED','COMPLETED','FAILED','RETRYABLE','DEAD_LETTERED','SKIPPED'));

CREATE INDEX IF NOT EXISTS idx_scan_attempts_retryable
  ON scan_attempts (tenant_id, scan_id, started_at DESC)
  WHERE status IN ('RETRYABLE','DEAD_LETTERED');
