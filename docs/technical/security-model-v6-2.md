# Security model Bevoac V6.2.0

## Authentication and authorization

- API keys are stored hashed and resolved server-side to a tenant and scopes.
- Admin authentication is OIDC only in production.
- Admin issuer, audience, tenant ID and application roles are validated.
- Shared-secret admin authentication is forbidden in production.

## Multi-tenant data security

- immutable request tenant context;
- PostgreSQL roles by workload;
- `NOINHERIT`, `NOBYPASSRLS`, forced RLS;
- transaction-local tenant setting;
- explicit tenant predicates;
- cross-tenant API/DB/PDF tests.

## Request integrity

Idempotency stores a canonical SHA-256 request fingerprint. Same key/same semantic request replays the existing scan; same key/different request returns HTTP 409.

## APIM/backend boundary

APIM injects a rotatable, secret backend credential. The public API refuses business requests that do not present it. A plain gateway marker is never trusted. Health and the Microsoft consent callback remain exempt and expose no customer result.

### Protection du state Terraform

Le jeton de frontière APIM est généré par Terraform. Sa valeur est donc connue de Terraform et enregistrée dans le state, même si APIM la stocke comme valeur nommée secrète et si l’API la lit depuis Key Vault. Le state de production est un actif sensible : chiffrement, contrôle d’accès minimal, journalisation, verrouillage, sauvegarde contrôlée et exclusion absolue des dépôts, packages source et dossiers de preuve. Toute exposition du state déclenche la rotation du jeton et une procédure d’incident.

## Worker safety

- typed retryable and terminal errors;
- Service Bus abandon/dead-letter/complete policy;
- sanitized customer error payloads;
- restricted operator logs;
- bounded module/global timeouts and AbortSignal propagation;
- bounded Resource Graph pagination with visible partial/truncation metadata.

## Web scanning

- HTTPS-only targets;
- DNS resolution of all addresses;
- internal/reserved range rejection;
- IP pinning and redirect revalidation;
- query/hash redaction in customer-visible output and logs.

## Frontend

The included Next.js frontend is a DEMO-ONLY artifact. It does not accept customer API keys, proxy arbitrary paths or represent synthetic data as live production posture.

## Residual risks before production acceptance

The source remediation must still be proven through full Node 24 CI, PostgreSQL/RLS integration, Terraform validate/plan, live notification tests, restore drill, load test, security assessment, real-tenant acceptance and rollback evidence.
## Azure onboarding result and legacy static page

The Microsoft callback redirects to `/v1/onboarding/azure/result`, a credential-free and script-free page hosted by the API. Status is read through the authenticated status endpoint. The historical static onboarding site is disabled by default, forbidden by the V6.2 controlled-production Terraform profile and contains no API-key field or active API call.

## Compteur de livraison Service Bus

Le worker traite `deliveryCount` comme un compteur commençant à 1. Une erreur transitoire est abandonnée avant le seuil ; au seuil `maxDeliveryCount`, l’état terminal est persisté puis le message est explicitement dead-lettered.
