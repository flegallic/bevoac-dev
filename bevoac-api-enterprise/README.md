# bevoac-api-enterprise v4

API control plane SaaS orientée B2B pour orchestrer les scans, isoler les tenants, gouverner le billing, générer les PDF et onboarder les environnements Azure clients via Microsoft admin consent.

## Fonctionnalités

- Authentification client par clé API Bearer.
- Tenant Bevoac dérivé de la clé API, jamais du body.
- Refus de `tenantId/customerId` dans les requêtes de scan.
- Allowlist web : `tenant_web_targets`.
- Allowlist Azure : `tenant_azure_scopes`.
- Onboarding Microsoft admin consent : `state` HMAC, TTL, anti-replay, vérification `api_key_id`.
- Vérification Azure Management `/subscriptions` avant inscription de scopes `VERIFIED`.
- Quotas mensuels et limites de ressources par plan.
- Billing overview, détail mensuel, ledger admin et clôture mensuelle.
- Rapport PDF à la demande.

## Endpoints

Client :

- `GET /v1/health`
- `POST /v1/scans`
- `GET /v1/scans`
- `GET /v1/scans/:scanId`
- `GET /v1/scans/:scanId/pdf`
- `GET /v1/billing/overview`
- `GET /v1/billing/current-month/scans`
- `POST /v1/onboarding/azure/start`
- `GET /v1/onboarding/azure/status`
- `POST /v1/onboarding/azure/verify`

Public callback :

- `GET /v1/onboarding/azure/callback`

Admin :

- `GET /v1/admin/billing/overview`
- `GET /v1/admin/billing/tenants/:tenantId/ledger`
- `POST /v1/admin/billing/close-month`

Documentation interactive :

- `GET /docs`

## Variables critiques

```env
NODE_ENV=production
ADMIN_API_SECRET=<32+ chars>
ONBOARDING_STATE_SECRET=<32+ chars distinct de ADMIN_API_SECRET>
API_PUBLIC_BASE_URL=https://<api_fqdn>
ONBOARDING_REDIRECT_URI=https://<api_fqdn>/v1/onboarding/azure/callback
ONBOARDING_FRONTEND_SUCCESS_URL=https://<frontend_fqdn>/success.html
ONBOARDING_ALLOW_INFER_REDIRECT_URI=false
MICROSOFT_CLIENT_ID=<app registration client id>
MICROSOFT_CLIENT_SECRET=<secret>
```

En production, `ONBOARDING_STATE_SECRET` est obligatoire. La fallback vers `ADMIN_API_SECRET` n'est tolérée qu'en développement local.

Note runtime Azure : l’API déployée ne lit pas le fichier `.env` local. Les variables ci-dessus sont injectées par Terraform/Container Apps/Key Vault. Le `.env` local sert uniquement aux scripts admin exécutés depuis le poste opérateur.


## Commandes admin

```bash
npm ci
node scripts/init-db.js
node scripts/check-db.js
node scripts/check-db-enterprise.js --limit 20
node scripts/create-tenant.js "Client Demo SAS" standard primary
node scripts/register-tenant-scope.js <bevoacTenantId> <microsoftTenantId> <subscriptionId|-> <https://host|->
node scripts/onboarding-status.js <bevoacTenantId>
node scripts/expire-onboarding-sessions.js
```

## Sécurité

- Les scans Azure ne sont autorisés que sur scopes backend vérifiés.
- Les scans web ne sont autorisés que sur hosts backend enregistrés.
- Les URLs web doivent être HTTPS et publiques.
- La route callback Microsoft est publique mais inutilisable sans `state` HMAC valide, non expiré, non consommé et rattaché à l'API key de départ.
