# Changelog enterprise hardening

## V6.1.2-enterprise-hardening-1

### Security

- Ajout de scopes fonctionnels sur les API keys.
- Ajout d'un contexte DB explicite tenant/service pour preparer RLS stricte.
- Ajout d'une migration RLS enterprise optionnelle avec `FORCE ROW LEVEL SECURITY`.
- Suppression du JSON complet par defaut sur l'endpoint de statut scan.
- Ajout d'un endpoint explicite `/v1/scans/:scanId/result`.
- Ajout d'un sanitizer d'erreurs publiques.

### Database

- Correction de la baseline DB pour `scan_reserved`, `scan_consumed`, `scan_refunded`.
- Ajout de `idempotency_key_source` a `scan_request_idempotency`.
- Ajout/normalisation des tables `scan_results`, `scan_attempts`, `outbox_events`.
- Ajout de colonnes runtime manquantes sur `scans`.
- Preparation DB multi-cloud via `cloud_provider IN ('azure','aws')`, sans activation runtime AWS.

### Refactoring

- Collector de findings centralise API/worker.
- Result-store tenant-aware.
- ScanService tenant-context aware.
- BillingService tenant/service-context aware.
- Outbox publisher service-context aware.
- Worker scan-store tenant-context aware.

### Documentation

- Runbook enterprise hardened V6.1.2 en Markdown et DOCX.
- Architecture enterprise hardened.
- Security model.
- AWS multi-cloud foundation.
- Matrice de validation.
