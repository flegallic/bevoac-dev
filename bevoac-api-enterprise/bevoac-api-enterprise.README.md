# bevoac-api-enterprise - V5.1 Azure-first

API control plane Bevoac pour demonstration et pilote B2B cadre.

## Statut

Cette API est le control plane Bevoac V5.1. Elle ne doit pas etre presentee comme production enterprise sans validation complementaire.

## Responsabilites

- authentification client par API key Bearer;
- derivation du tenant Bevoac depuis la cle API;
- rejet de `tenantId` et `customerId` fournis par le client;
- allowlist web via `tenant_web_targets`;
- allowlist Azure via `tenant_azure_scopes`;
- onboarding Microsoft admin consent;
- creation et consultation de scans;
- publication Service Bus;
- billing, quotas et backpressure;
- generation PDF;
- routes admin billing via OIDC en production.

## Points V5.1 importants

- `scan_results` est le stockage courant des resultats complets.
- `scans.result` est legacy/fallback.
- L'idempotency key serveur est une exigence produit P0 a livrer si non encore implemente cote API.
- Le contrat de message doit etre aligne avec `contracts/scan-message-version.json`.

## Production / pilote

Pour un pilote securise:

- `ADMIN_AUTH_MODE=oidc`;
- `ONBOARDING_STATE_SECRET` obligatoire;
- `ONBOARDING_ALLOW_INFER_REDIRECT_URI=false`;
- Service Bus managed identity;
- PostgreSQL SSL verify-full;
- Key Vault pour les secrets.
