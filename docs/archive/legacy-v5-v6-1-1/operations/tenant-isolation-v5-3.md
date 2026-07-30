# Bevoac V5.3 - Tenant isolation guardrails

## Goal

V5.3 introduces non-breaking database-level tenant integrity guardrails. They are compensating controls for environments where strict PostgreSQL RLS is not yet enabled.

## Implemented controls

- Composite uniqueness on `scans(id, tenant_id)`.
- Foreign key tenant matching for `scan_results`, `scan_attempts`, and `scan_request_idempotency`.
- Trigger-based guard for `outbox_events` scan events.
- Trigger-based guard for `billing_usage_ledger` scan-linked entries.
- `tenant_isolation_violations` operator view.
- `npm run check:tenant-isolation` DB verification script.

## Verification

```bash
cd bevoac-api-enterprise
npm run migrate-db
npm run check:tenant-isolation
```

Expected result:

```text
Tenant isolation integrity checks passed.
```

## Why strict RLS is optional

Strict RLS requires all API, worker, PDF, outbox and retention database transactions to set `SET LOCAL app.tenant_id = '<tenant uuid>'`. Enabling RLS without this application-wide transaction discipline can break the runtime. V5.3 therefore ships a safe compensating-control baseline and an optional RLS blueprint under `migrations/optional/`.


> Documentation V5.3 alignment note: this file is part of the active V5.3 documentation set. V5.2 equivalents are historical references only.
