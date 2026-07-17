-- Bevoac V5.3 tenant isolation guardrails.
-- Purpose: provide non-breaking compensating controls for multi-tenant integrity.
-- This does not enable PostgreSQL RLS by default. Strict RLS remains an optional enterprise hardening mode.

CREATE UNIQUE INDEX IF NOT EXISTS uq_scans_id_tenant
  ON scans (id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_scan_results_tenant_scan
  ON scan_results (tenant_id, scan_id);

CREATE INDEX IF NOT EXISTS idx_scan_attempts_tenant_scan
  ON scan_attempts (tenant_id, scan_id);

CREATE INDEX IF NOT EXISTS idx_outbox_events_tenant_aggregate
  ON outbox_events (tenant_id, aggregate_type, aggregate_id);

CREATE INDEX IF NOT EXISTS idx_billing_ledger_tenant_scan
  ON billing_usage_ledger (tenant_id, scan_id)
  WHERE scan_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_scan_results_scan_tenant') THEN
    ALTER TABLE scan_results
      ADD CONSTRAINT fk_scan_results_scan_tenant
      FOREIGN KEY (scan_id, tenant_id)
      REFERENCES scans(id, tenant_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

ALTER TABLE scan_results VALIDATE CONSTRAINT fk_scan_results_scan_tenant;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_scan_attempts_scan_tenant') THEN
    ALTER TABLE scan_attempts
      ADD CONSTRAINT fk_scan_attempts_scan_tenant
      FOREIGN KEY (scan_id, tenant_id)
      REFERENCES scans(id, tenant_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

ALTER TABLE scan_attempts VALIDATE CONSTRAINT fk_scan_attempts_scan_tenant;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_scan_idempotency_scan_tenant') THEN
    ALTER TABLE scan_request_idempotency
      ADD CONSTRAINT fk_scan_idempotency_scan_tenant
      FOREIGN KEY (scan_id, tenant_id)
      REFERENCES scans(id, tenant_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

ALTER TABLE scan_request_idempotency VALIDATE CONSTRAINT fk_scan_idempotency_scan_tenant;


CREATE OR REPLACE FUNCTION bevoac_assert_billing_scan_tenant()
RETURNS trigger AS $$
BEGIN
  IF NEW.scan_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM scans s
      WHERE s.id = NEW.scan_id
        AND s.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'billing ledger scan tenant mismatch for scan_id=% tenant_id=%', NEW.scan_id, NEW.tenant_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_billing_scan_tenant_guard ON billing_usage_ledger;
CREATE TRIGGER trg_billing_scan_tenant_guard
BEFORE INSERT OR UPDATE OF scan_id, tenant_id
ON billing_usage_ledger
FOR EACH ROW
EXECUTE FUNCTION bevoac_assert_billing_scan_tenant();

CREATE OR REPLACE FUNCTION bevoac_assert_outbox_scan_tenant()
RETURNS trigger AS $$
BEGIN
  IF NEW.aggregate_type = 'scan' THEN
    IF NOT EXISTS (
      SELECT 1 FROM scans s
      WHERE s.id = NEW.aggregate_id
        AND s.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'outbox scan tenant mismatch for aggregate_id=% tenant_id=%', NEW.aggregate_id, NEW.tenant_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_outbox_scan_tenant_guard ON outbox_events;
CREATE TRIGGER trg_outbox_scan_tenant_guard
BEFORE INSERT OR UPDATE OF aggregate_type, aggregate_id, tenant_id
ON outbox_events
FOR EACH ROW
EXECUTE FUNCTION bevoac_assert_outbox_scan_tenant();

CREATE OR REPLACE VIEW tenant_isolation_violations AS
SELECT 'scan_results' AS source, r.scan_id, r.tenant_id
FROM scan_results r
LEFT JOIN scans s ON s.id = r.scan_id AND s.tenant_id = r.tenant_id
WHERE s.id IS NULL
UNION ALL
SELECT 'scan_attempts' AS source, a.scan_id, a.tenant_id
FROM scan_attempts a
LEFT JOIN scans s ON s.id = a.scan_id AND s.tenant_id = a.tenant_id
WHERE s.id IS NULL
UNION ALL
SELECT 'outbox_events' AS source, o.aggregate_id AS scan_id, o.tenant_id
FROM outbox_events o
LEFT JOIN scans s ON s.id = o.aggregate_id AND s.tenant_id = o.tenant_id
WHERE o.aggregate_type = 'scan' AND s.id IS NULL
UNION ALL
SELECT 'billing_usage_ledger' AS source, b.scan_id, b.tenant_id
FROM billing_usage_ledger b
LEFT JOIN scans s ON s.id = b.scan_id AND s.tenant_id = b.tenant_id
WHERE b.scan_id IS NOT NULL AND s.id IS NULL
UNION ALL
SELECT 'scan_request_idempotency' AS source, i.scan_id, i.tenant_id
FROM scan_request_idempotency i
LEFT JOIN scans s ON s.id = i.scan_id AND s.tenant_id = i.tenant_id
WHERE s.id IS NULL;
