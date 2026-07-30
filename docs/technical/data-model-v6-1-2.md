# Modèle de données V6.1.2

## Tables principales

- `tenants`, `api_keys` ;
- `azure_onboarding_sessions`, `tenant_azure_integrations`, `tenant_azure_scopes`, `tenant_web_targets` ;
- `scans`, `scan_results`, `scan_attempts`, `scan_request_idempotency` ;
- `billing_usage_ledger`, `billing_monthly_snapshots` ;
- `outbox_events` ;
- `retention_audit_log`, `admin_audit_log` ;
- `schema_migrations`.

## Invariants

- clés composites scan/tenant sur les tables dépendantes ;
- triggers de cohérence billing/outbox ;
- lifecycle billing RESERVED/CONSUMED/REFUNDED ;
- résultat complet séparé de la métadonnée scan ;
- RLS forcée sur 15 tables, `schema_migrations` exclue.
