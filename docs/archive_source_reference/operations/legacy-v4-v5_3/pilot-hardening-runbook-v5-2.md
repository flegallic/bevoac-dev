# Bevoac V5.2 pilot hardening runbook

## Objectif

Ce runbook décrit les contrôles à exécuter après application du package hardening V5.2.

## Corrections livrées

| Priorité | Correction | Vérification attendue |
|---|---|---|
| P0 | Transactional outbox scans | `outbox_events` contient l'événement `scan.requested`, puis passe `PUBLISHED` après publication Service Bus. |
| P0 | Idempotency key serveur | `POST /v1/scans` sans header retourne `idempotencyKeySource=server_generated`. |
| P0 | Sync contrats API/worker | `npm run check` vérifie schema et version partagés. |
| P1 | Tests multi-tenant/auth | `npm test` côté API. |
| P1 | Migrations DB versionnées | `npm run migrate-db`. |
| P1 | Billing reserved/consumed/refunded | Ledger : `scan_reserved` à la création, `scan_consumed` si DONE, `scan_refunded` si FAILED. |
| P1 | Retry/backoff Azure/Graph | Worker retry sur Graph/ARM/Resource Graph pour erreurs transitoires. |
| P1 | Scheduler rétention | Container Apps Job `job-*-retention`. |
| P1 | Alerting complet | Alertes DLQ, backlog Service Bus, CPU/memory/storage PostgreSQL. |
| P2 | APIM gateway | `enable_apim_gateway=true` crée APIM avec rate limiting edge. |

## Vérification rapide API

```bash
cd bevoac-api-enterprise
npm install
npm run check
npm test
npm run migrate-db
```

## Vérification outbox

```sql
SELECT status, COUNT(*) FROM outbox_events GROUP BY status ORDER BY status;
SELECT id, aggregate_id, tenant_id, event_type, status, attempts, last_error
FROM outbox_events
ORDER BY created_at DESC
LIMIT 10;
```

## Vérification idempotence serveur

```bash
curl -s -X POST "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"cloudProvider":"azure","scanProfile":"web","modules":["web"],"azure":{"targetUrl":"https://example.com"}}' | jq .
```

Attendu :

```json
{
  "idempotencyKeySource": "server_generated",
  "idempotentReplay": false
}
```

## Vérification billing

```sql
SELECT scan_id, event_type, amount_eur_ht, metadata, recorded_at
FROM billing_usage_ledger
ORDER BY recorded_at DESC
LIMIT 20;
```

Attendu :

- création : `scan_reserved` ;
- scan `DONE` : `scan_consumed` ;
- scan `FAILED` : `scan_refunded`.

## Points restant à prouver en environnement réel

- scan web réel ;
- scan Azure infra réel ;
- onboarding Microsoft admin consent ;
- DLQ zéro après traitement ;
- exécution retention réelle ;
- alertes déclenchées puis résolues ;
- backup/restore PostgreSQL ;
- pentest API/SSRF/PDF/auth.
