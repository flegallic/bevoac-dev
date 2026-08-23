# Test strategy Bevoac V6.2.0

## Layers

- unit: canonicalization, error taxonomy, module catalog, sanitization;
- integration: API + PostgreSQL, migrations, RLS, billing/outbox;
- contract: API/worker schema compatibility;
- security: SSRF, IDOR, tenant isolation, APIM boundary, OIDC;
- resilience: retry, abandon, dead-letter, worker restart, outbox replay;
- performance: multi-tenant load, P50/P95/P99, backlog and cost;
- operations: notification, restore, rollback and incident exercise;
- acceptance: real Azure tenant, read-only scope and offboarding.

## Required V6.2 scenarios

- same idempotency key/different request returns 409;
- Resource Graph exceeds 1,000 rows without silent loss;
- transient 429/503 abandons then retries;
- terminal permission/validation error completes with safe customer message;
- failed tenant-context rollback destroys the pool client;
- direct Container Apps business call is refused;
- APIM call succeeds;
- demo frontend contains no browser credential storage or live fallback.

## Worker R2

- interprétation one-based du delivery count Service Bus ;
- `markRejectedMessage` atomique avec remboursement et tentative `DEAD_LETTERED` ;
- abandon du message si la persistance du rejet échoue ;
- provider non activé : acquisition, persistance terminale et DLQ ;
- tentative obsolète incapable d’écraser résultat ou billing ;
- statut `PARTIAL` sur troncature Resource Graph après analyse ;
- gate de résolution des imports relatifs.
