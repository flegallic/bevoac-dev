# Contrat API V6.1.2

## Authentification

- client : `Authorization: Bearer <API key>` ;
- tenant dérivé côté serveur ;
- scopes : scan create/read/result/pdf, billing, onboarding ;
- admin : OIDC dans le runtime admin dédié.

## Endpoints principaux

- `GET /v1/health`
- `POST /v1/scans`
- `GET /v1/scans`
- `GET /v1/scans/:scanId`
- `GET /v1/scans/:scanId/result`
- `GET /v1/scans/:scanId/pdf`
- `GET /v1/billing/overview`
- `GET /v1/billing/current-month/scans`
- onboarding Azure start/status/verify/callback
- endpoints admin billing dans `admin_api`.

## Invariants

- aucun `tenantId/customerId` client ;
- idempotency key bornée ;
- target web HTTPS autorisée ;
- scopes Azure vérifiés ;
- lecture d'un autre tenant : 404/invisible ;
- JSON complet uniquement via endpoint explicite ou option autorisée.
