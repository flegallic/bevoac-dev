# Bevoac V4 - Audit code/documentation et préparation démo client

## Verdict synthétique

L'archive V4 est cohérente pour une démo client B2B avancée : l'API, le worker, l'IaC, le frontend d'onboarding, les schémas Mermaid et le runbook décrivent désormais le même modèle cible.

Le modèle technique est crédible pour un POC commercial : API control plane, worker asynchrone, isolation logique par tenant, allowlists backend, admin consent Microsoft, vérification RBAC/subscriptions, quotas, limites de ressources, historique mensuel et PDF.

Ce livrable ne doit pas être présenté comme production certifiée sans validation live Azure, tests de charge, pentest et durcissement réseau final. La posture est néanmoins structurée, démontrable et extensible.

## Corrections V4 appliquées

| Zone | Correction |
|---|---|
| Terraform | Correction du bloc `secret admin-api-secret` dans `container-apps.tf` qui contenait des lignes HCL invalides dans la V3 |
| Onboarding | Production : `ONBOARDING_STATE_SECRET` est maintenant obligatoire et ne retombe plus silencieusement sur `ADMIN_API_SECRET` |
| Onboarding | Le callback vérifie aussi l'`api_key_id` stocké en session, en plus du `state_hash`, `tenant_id`, `id` et statut `STARTED` |
| Redirect URI | L'inférence via headers est bloquée en production ; `ONBOARDING_REDIRECT_URI` doit être configurée explicitement |
| IaC | Ajout de validations Terraform sur les secrets, client ID et `api_public_base_url` |
| DB scripts | `check-db.js` et `check-db-enterprise.js` couvrent les tables V3/V4 d'onboarding et allowlist |
| Scripts admin | Ajout de `expire-onboarding-sessions.js` pour marquer les sessions STARTED expirées |
| Documentation | Runbook complet V4 avec installation, commandes admin/client, URLs API, modules scannés, sécurité, démo from scratch |
| Mermaid | Sources Mermaid V4 livrées pour architecture, onboarding, cycle de scan et isolation tenant |
| Worker | Correction du passage du `microsoftTenantId` au module `entra_b2b` au lieu de dépendre d'une propriété non garantie du credential Azure |
| Versions | API et worker alignés en `4.0.0` |

## Alignement code / documentation

### Routes API

Le code expose les routes suivantes et le runbook les documente toutes :

- `GET /v1/health`
- `POST /v1/scans`
- `GET /v1/scans`
- `GET /v1/scans/:scanId`
- `GET /v1/scans/:scanId/pdf`
- `GET /v1/billing/overview`
- `GET /v1/billing/current-month/scans`
- `POST /v1/onboarding/azure/start`
- `GET /v1/onboarding/azure/callback`
- `GET /v1/onboarding/azure/status`
- `POST /v1/onboarding/azure/verify`
- `GET /v1/admin/billing/overview`
- `GET /v1/admin/billing/tenants/:tenantId/ledger`
- `POST /v1/admin/billing/close-month`
- `GET /docs`

### Tables DB

Le runbook, `components.md` et `init-db.js` sont alignés sur les tables : `tenants`, `api_keys`, `tenant_azure_scopes`, `tenant_azure_integrations`, `azure_onboarding_sessions`, `tenant_web_targets`, `scans`, `billing_usage_ledger`, `billing_monthly_snapshots`, `scan_request_idempotency`, `admin_audit_log`.

### Modules de scan

Le contrat API/worker et le runbook listent les mêmes modules : `web`, `entra`, `storage`, `vms`, `nsg`, `keyvault`, `logs`, `db`, `governance`, `appservices`, `finops`, `entra_b2b`, `tags`.

## Sécurité analysée

### Points solides

- Tenant Bevoac dérivé de la clé API, pas du body.
- Refus explicite de `tenantId/customerId` dans `POST /v1/scans`.
- API key hashée en base.
- Target web HTTPS uniquement, blocage localhost/private/internal/link-local.
- Allowlist `tenant_web_targets` obligatoire pour le web.
- Allowlist `tenant_azure_scopes` obligatoire pour tenant Microsoft et subscriptions.
- Subscription autorisée uniquement si `status='VERIFIED'`.
- Admin consent protégé par `state` HMAC, TTL, hash DB, usage unique et session rattachée à l'API key.
- Production sans inférence de redirect URI depuis headers.
- Secrets injectés depuis Key Vault.
- Runtime Service Bus en Managed Identity pour API/worker.
- PostgreSQL limité à l'egress NAT Container Apps et option admin explicite.
- Quota standard/business bloquant, sans PAYG automatique.
- Preflight Resource Graph avant scan infra.

### Points à valider avant production

- App registration Microsoft réelle et permissions Graph/ARM adaptées.
- Role assignments Azure RBAC chez le client : Reader/Security Reader minimum selon modules.
- Tests live de `/subscriptions` et Resource Graph.
- Tests de charge API/worker, DLQ Service Bus, timeouts et volumétrie PostgreSQL.
- Private Endpoints / réseau privé pour Key Vault et PostgreSQL si exigence production stricte.
- Rotation secrets et révocation API keys.
- Politique de rétention résultats de scans et conformité RGPD.
- Pentest externe.

## Crédibilité architecture

Le découplage API/worker par Service Bus donne une base multi-tenant crédible : l'API reste rapide, les traitements lourds sont asynchrones, les quotas sont appliqués avant enqueue, et la persistance centralise la traçabilité.

La limite principale est l'isolation compute : l'archive implémente une isolation logique tenant forte, mais pas encore un worker/sandbox dédié par tenant ou par scan. Pour la démo et le POC, c'est acceptable si clairement expliqué. Pour une offre enterprise sensible, une évolution vers pools de workers isolés par client premium ou jobs éphémères dédiés serait pertinente.

## Potentiel d'évolution

Priorités V5 recommandées :

1. Azure Lighthouse en option pour délégation client entreprise.
2. RBAC check plus fin par module, avec diagnostic de permissions manquantes.
3. Portail client authentifié plutôt que saisie de clé API dans un frontend statique.
4. Rétention configurable et chiffrement applicatif optionnel des résultats de scan.
5. Worker isolation tiers : shared, dedicated pool, ephemeral job.
6. Export JSON/CSV/SIEM et webhooks post-scan.
7. Dashboards SLO et alertes Azure Monitor.
8. Pipeline CI avec tests unitaires, `terraform validate`, `npm audit`, scan container et tests e2e mock Azure.
