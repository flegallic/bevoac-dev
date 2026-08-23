# Operations runbook Bevoac V6.2.0

## Required tools

- Node.js 24;
- Terraform 1.14.7;
- Azure CLI;
- PostgreSQL client for controlled DB operations;
- access through named operator identities.

## Normal operation

1. Check API liveness/readiness.
2. Check Service Bus active and dead-letter counts.
3. Check outbox age and scan age.
4. Check PostgreSQL CPU, storage and connections.
5. Check Action Group and alert status.
6. Review expiring secrets.

## Deployment discipline

```text
READ_ONLY -> CODE_ONLY -> TEST -> PLAN_ONLY -> APPROVAL -> APPLY -> VERIFY -> EVIDENCE
```

Never combine a database migration, network change, secret rotation and major runtime refactor in one change window.

## Release profile

Use `release/v6.2.0-controlled-production.tfvars.example` only as a template. Real values belong in a protected operator file and are never committed.

## Rollback

- preserve the previous healthy Container Apps revision;
- do not retire compatibility resources until smoke and traffic promotion succeed;
- database migrations are additive;
- if health, billing, outbox, DLQ or tenant isolation fail, stop rollout and return traffic to the prior revision.

## Frontend

Do not position the bundled frontend as a customer portal. Its deployment requires an explicit demo-only confirmation.
## Azure onboarding user interface

Use the authenticated API workflow. The API-hosted `/v1/onboarding/azure/result` page requests no credential and displays no tenant data. `deploy_onboarding_frontend` must remain `false` in controlled production. The historical static page is a non-interactive DEMO-ONLY explanation page.

## Contrat de message invalide

Lorsque `scanId` et `tenantId` sont des UUID sûrs mais que le contrat du message est invalide, le worker terminalise atomiquement le scan `PENDING`, enregistre un résultat client expurgé, rembourse la réservation, inscrit une tentative `DEAD_LETTERED`, puis place le message en DLQ avec la raison `INVALID_SCAN_REQUEST`. Si la persistance échoue, le message est abandonné afin de préserver la possibilité de cohérence ultérieure. Un message sans identité sûre est directement placé en DLQ sans tentative de mutation DB.
