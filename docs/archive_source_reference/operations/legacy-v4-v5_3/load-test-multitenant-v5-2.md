# Load test multi-tenant Bevoac V5.2

## Statut

Load test multi-tenant enterprise: Non confirme dans le depot analyse.

## Objectif pilote

Verifier que plusieurs tenants peuvent creer et suivre des scans sans fuite de donnees ni saturation immediate.

## Scenarios minimaux

- 2 tenants web.
- 1 tenant Azure infra verifie.
- Creation scans web avec idempotency keys uniques.
- Listing scans par tenant.
- Verification 429 backpressure attendue.
- DLQ = 0 hors test volontaire.
- Pas de PENDING ancien > 10 min.

## Controle DB apres test

```sql
SELECT tenant_id, status, COUNT(*) FROM scans WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY tenant_id, status;
SELECT status, COUNT(*) FROM outbox_events WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY status;
SELECT id, tenant_id, status, created_at FROM scans WHERE status = 'PENDING' AND created_at < NOW() - INTERVAL '10 minutes';
```

## Critere Go

- 5xx quasi nul;
- 429 accepte si backpressure;
- 0 scan ancien bloque;
- 0 DLQ;
- isolation tenant preservee.
