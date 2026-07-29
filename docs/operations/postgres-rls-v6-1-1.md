# Bevoac V6.1.1 - PostgreSQL RLS confirmed path

## Objectif

Confirmer la presence de Row Level Security sur les tables tenant-scoped sans casser les traitements API/worker/outbox/retention.

## Application

```bash
cd bevoac-api-enterprise
ALLOW_RLS_APPLY=true npm run migrate-db:rls
npm run check:rls
```

## Tables couvertes

- scans
- scan_results
- scan_attempts
- scan_request_idempotency
- billing_usage_ledger
- outbox_events
- tenant_web_targets
- tenant_azure_scopes

## Limite documentee

La migration installe un contexte service explicite `app.service_context` pour les traitements backend. Pour un durcissement enterprise strict, creer un role runtime non-owner et executer des tests de denial effectifs par role.
