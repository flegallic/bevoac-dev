# Acceptance staging et production V6.1.2

## Staging obligatoire

- images immuables ;
- comptes PostgreSQL dédiés ;
- migration RLS appliquée ;
- API/outbox/worker/admin/retention séparés ;
- tests tenant A/B ;
- scan, billing, outbox, Service Bus, worker, JSON et PDF ;
- monitoring et rollback.

## Rollout

```text
révision candidate à 0 %
→ smoke tests
→ 5 %
→ observation
→ 25 %
→ observation
→ 100 %
```

## Arrêt immédiat

- hausse 5xx ;
- `permission denied` anormal ;
- backlog outbox/DLQ ;
- billing divergent ;
- scan bloqué ;
- lecture intertenant ;
- rollback indisponible.
