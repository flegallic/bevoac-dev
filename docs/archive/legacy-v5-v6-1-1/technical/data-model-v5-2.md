# Modele de donnees Bevoac V5.2

## Tables principales

| Table | Role |
|---|---|
| `tenants` | Clients Bevoac |
| `api_keys` | API keys hashees |
| `tenant_web_targets` | Allowlist web par tenant |
| `tenant_azure_scopes` | Allowlist Azure par tenant |
| `scans` | Statut, cible, billing, timestamps |
| `scan_results` | Resultat JSON complet, compression, hash, resume |
| `scan_attempts` | Tentatives worker |
| `scan_request_idempotency` | Cle idempotence tenant |
| `outbox_events` | Transactional outbox |
| `billing_usage_ledger` | Ledger billing |
| `billing_monthly_snapshots` | Snapshot mensuel |
| `retention_audit_log` | Audit retention |

## Scan lifecycle

1. `POST /v1/scans` cree `scans.status=PENDING`, `billing_state=RESERVED`.
2. Ledger recoit `scan_reserved`.
3. Outbox recoit `scan.requested`.
4. Worker passe `IN_PROGRESS`.
5. Worker stocke le resultat.
6. Worker finalise `DONE/CONSUMED` ou `FAILED/REFUNDED`.

## Legacy

`scans.result` est legacy. La source principale est `scan_results`.
