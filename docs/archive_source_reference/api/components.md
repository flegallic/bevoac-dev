## Stack
- Node.js / Fastify (framework léger et performant)
- PostgreSQL
- Azure Service Bus
- Azure Container Apps
- Azure Key Vault
- Azure France Central

## Modèles d'audit disponibles
- **Version revue dans le code joint** : `cloudProvider=azure` uniquement.
- **Profils supportés** : `web`, `entra`, `infra`, `full`.
- **Modules supportés dans le worker** : `web`, `entra`, `storage`, `vms`, `nsg`, `keyvault`, `logs`, `db`, `governance`, `appservices`, `finops`, `entra_b2b`, `tags`.
- **Trajectoire produit** : extension multi-cloud possible ultérieurement, sans impact sur la structure générale du control plane.

## Architecture technique
```
┌──────────────────────────────────────────────────────────────┐
│                        CONTROL PLANE                         │
│  Fastify API  →  Service Bus  →  PostgreSQL                  │
│  (auth API key/admin, quotas, billing, idempotency request)  │
└───────────────────────────┬──────────────────────────────────┘
                            │ message `scan.requested`
┌───────────────────────────▼──────────────────────────────────┐
│                         DATA PLANE                           │
│  Azure Container App Worker (scale-to-zero, file-based)     │
│  1. Consomme la queue `scan-jobs`                            │
│  2. Marque le scan `IN_PROGRESS`                             │
│  3. Exécute les modules web / Entra / Azure infra            │
│  4. Stocke le résultat JSON dans `scans.result`              │
│  5. Met à jour le scan en `DONE` ou `FAILED`                 │
└──────────────────────────────────────────────────────────────┘
```

## Invariants
- **API synchrone, exécution asynchrone** : `POST /v1/scans` crée le scan puis publie un message dans Service Bus ; le traitement réel est fait par le worker.
- **Worker stateless au niveau applicatif** : le worker ne conserve pas d'état métier local entre deux scans ; le résultat durable est stocké dans PostgreSQL.
- **Scale-to-zero côté worker** : le worker peut retomber à `0` réplica quand la file est vide, mais l'exécution n'est **pas** un modèle “1 scan = 1 sandbox dédié”.
- **Traçabilité métier** : corrélation par `scan_id`, `tenant_id`, `request.id` Fastify et écritures de billing.
- **Isolation actuelle** : isolation logique par tenant dans l'API et la base ; l'archive jointe ne démontre pas une isolation compute “single-tenant par scan”.

## Architecture opérationnelle de référence
### 1.1 Control Plane (implémenté dans l'archive revue)
**Responsabilités** : AuthN/AuthZ, orchestration, persistance, billing, exposition API et endpoints admin.

Composants :
- **API Fastify** :
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
- **Swagger UI** : `/docs`
- **Queue Service Bus** : `scan-jobs`
- **PostgreSQL** : tables `tenants`, `api_keys`, `tenant_azure_integrations`, `tenant_azure_scopes`, `azure_onboarding_sessions`, `tenant_web_targets`, `scans`, `billing_usage_ledger`, `billing_monthly_snapshots`, `scan_request_idempotency`, `admin_audit_log`
- **Key Vault** : secrets d'exécution (mot de passe PostgreSQL, secret admin, secret Microsoft côté worker, secret Service Bus pour la règle de scale KEDA)

### 1.2 Worker asynchrone (implémenté dans l'archive revue)
**Responsabilités** : consommer la queue, exécuter les modules, enrichir `scans.result`, finaliser le statut.

Composants :
- **Worker Azure Container App**
  - scale-to-zero si file vide
  - consommation concurrente contrôlée par `RECEIVER_MAX_CONCURRENT_CALLS`
- **Scanners web** : headers, TLS, DNS, `nmap`
- **Audit Entra**
- **Audit Azure infra** : `storage`, `vms`, `nsg`, `keyvault`, `logs`, `db`, `governance`, `appservices`, `finops`, `entra_b2b`, `tags`

### 1.3 Identité et accès Azure (état réel du code)
- **Service Bus côté API** : support **Managed Identity** ou connection string de secours.
- **Service Bus côté worker** : support **Managed Identity** au runtime ; la règle de scale KEDA s'appuie dans l'IaC fournie sur un secret de connection string stocké dans Key Vault.
- **Scans Azure cross-tenant** : le worker construit aujourd'hui un `ClientSecretCredential(targetTenantId, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET)`.
- **Conclusion d'alignement** : l'archive fournie n'implémente pas un modèle “zéro secret” pour les audits Azure cross-tenant.

## Principe clé : ce qui est détruit vs ce qui persiste
### 2.1 Éphémère / non durable
- Réplicas worker quand ils sont arrêtés par Container Apps.
- Mémoire du process Node.js pendant l'exécution du scan.
- Fichiers temporaires éventuels créés localement par un module pendant son exécution.

### 2.2 Persistant
- `scans` : statut, périmètre, résultat JSON, timestamps
- `billing_usage_ledger` : événements de billing append-only
- `billing_monthly_snapshots` : vue mensuelle de consommation / clôture
- `scan_request_idempotency` : clé d'idempotence de création
- `admin_audit_log` : clôture mensuelle de billing
- `tenant_azure_integrations` : consentement et statut RBAC par tenant Microsoft
- `tenant_azure_scopes` : allowlist tenant/subscription Azure
- `tenant_web_targets` : allowlist des hosts web HTTPS
- `azure_onboarding_sessions` : sessions Microsoft admin consent courtes et anti-replay

> Dans l'archive revue, le **rapport JSON** est stocké dans PostgreSQL (`scans.result`). Il n'y a pas de **Report Store objet** implémenté dans ce lot.

## Cycle de vie réel (end-to-end)
### Étapes
1) **Client** → `POST /v1/scans`
   - Auth API key OK
   - validation du body
   - calcul des unités de billing
   - écriture du scan en `PENDING`
   - écriture du ledger + snapshot mensuel

2) **Publication Service Bus**
   - message `scan.requested`
   - payload versionné avec `scanId`, `tenantId`, `scanProfile`, `modules`, cible Azure

3) **Traitement worker**
   - validation du message
   - `markInProgress`
   - exécution des modules demandés
   - stockage du résultat JSON dans `scans.result`
   - `markCompleted` ou `markFailed`

4) **Consultation**
   - `GET /v1/scans/{scanId}` → statut + résultat JSON
   - `GET /v1/scans/{scanId}/pdf` → PDF exécutif synthétique si statut `DONE` ou `FAILED`
   - `GET /v1/billing/overview` → vue mensuelle côté tenant
   - `GET /v1/billing/current-month/scans` → détail mensuel des scans client
   - `GET /v1/onboarding/azure/status` → état d'onboarding et scopes Azure
   - routes admin billing sous `/v1/admin/billing/*`

## Modèle de données minimal (implémenté)
### Tables
- `tenants`
- `api_keys`
- `scans`
- `billing_usage_ledger`
- `billing_monthly_snapshots`
- `scan_request_idempotency`
- `admin_audit_log`
- `tenant_azure_integrations`
- `tenant_azure_scopes`
- `tenant_web_targets`
- `azure_onboarding_sessions`

> Il n'y a pas, dans cette archive, de tables `audit_events`, `usage_events` ou `billing_ledger` séparées du ledger réellement implémenté.

## Endpoints réellement supportés
- `GET /v1/health`
- `POST /v1/scans` → `201` si création, `200` en replay idempotent
- `GET /v1/scans`
- `GET /v1/scans/{id}`
- `GET /v1/scans/{id}/pdf`
- `GET /v1/billing/overview`
- `GET /v1/billing/current-month/scans`
- `POST /v1/onboarding/azure/start`
- `GET /v1/onboarding/azure/callback`
- `GET /v1/onboarding/azure/status`
- `POST /v1/onboarding/azure/verify`
- `GET /v1/admin/billing/overview`
- `GET /v1/admin/billing/tenants/{tenantId}/ledger`
- `POST /v1/admin/billing/close-month`

> Dans cette archive, il n'y a pas de route `/usage`, pas de `/webhooks`, et pas de route distincte `GET /v1/scans/{id}/report`.

## Isolation “haute assurance” : état réel vs cible
### 6.1 Ce que le code joint démontre
- Isolation logique par `tenant_id` côté API / DB.
- Auth API key tenant + auth admin séparée.
- Worker stateless au niveau applicatif.
- Secrets applicatifs stockés dans Key Vault côté déploiement.

### 6.2 Ce que le code joint ne démontre pas encore
- Sandbox dédié **par scan**.
- Zéro secret pour l'audit Azure cross-tenant.
- Report store objet séparé.
- Webhooks de notification.
- Reaper / cleaner dédié dans le code fourni.

## Metering & Billing
### 7.1 Vue actuelle
- Le billing est écrit dans `billing_usage_ledger` au moment de la création du scan.
- Les snapshots mensuels sont consolidés dans `billing_monthly_snapshots`.
- La clôture du mois passe par `POST /v1/admin/billing/close-month`.

### 7.2 Ce qui n'est pas présent dans ce lot
- Endpoint `/usage`
- Ledger séparé d'une autre table que `billing_usage_ledger`
- Job autonome d'archivage de preuve mensuelle dans l'archive revue

## Fiabilité : état du code joint
### 8.1 Idempotence
- Idempotence de création via `scan_request_idempotency`.
- En replay idempotent, l'API renvoie le `scanId` existant.

### 8.2 Queue at-least-once
- Le worker consomme Service Bus avec `autoCompleteMessages: false`.
- En erreur non gérée, le message est `abandonMessage` et peut être retraité.
- Le code joint ne met pas en place de couche externe de déduplication de résultat ou de report store.

### 8.3 Timeouts et capacités
- Timeout global worker : `GLOBAL_SCAN_TIMEOUT_SECONDS` (180 secondes par défaut).
- TTL message API Service Bus : `SERVICEBUS_MESSAGE_TTL_SECONDS` (300 secondes par défaut).
- Le découplage asynchrone améliore la robustesse, mais ne constitue pas une garantie “scan de 30 minutes sans autre adaptation”.

## Observabilité
### 9.1 Corrélation disponible
- `request.id` Fastify
- `scanId`
- `tenantId`

### 9.2 Exposition actuelle
- logs API / worker
- `/v1/health`
- vues billing par tenant / admin

## Exploitabilité
### 10.1 Provisioning réellement fourni
- Terraform Azure pour Resource Group, ACR, Key Vault, PostgreSQL Flexible Server, Service Bus, Container Apps, frontend d'onboarding
- scripts de bootstrap / déploiement d'images

### 10.2 Points de vigilance documentaires
- PostgreSQL est provisionné en **public access avec firewall strict** dans l'IaC jointe.
- Key Vault est provisionné en accès public Azure avec RBAC.
- L'API et le worker utilisent le compte admin PostgreSQL configuré par l'IaC.

## Addendum V2 - isolation client par allowlist

La creation de scan ne fait plus confiance a un `tenantId` fourni dans le corps HTTP. Le tenant Bevoac est derive de la cle API. Les cibles demandees sont ensuite autorisees via deux tables backend :

- `tenant_azure_scopes` : Microsoft tenant ID et subscriptions autorises par tenant Bevoac.
- `tenant_web_targets` : hosts HTTPS autorises par tenant Bevoac.

Un client ne peut donc pas scanner arbitrairement un tenant Azure, une subscription ou un domaine qui n'a pas ete enregistre pour lui.

## Addendum V3 - onboarding Azure admin consent

La V3 ajoute une couche d'onboarding securisee au control plane :

- `POST /v1/onboarding/azure/start`
- `GET /v1/onboarding/azure/callback`
- `GET /v1/onboarding/azure/status`
- `POST /v1/onboarding/azure/verify`

Nouvelles tables :

- `azure_onboarding_sessions` : sessions courtes, state hash, anti-replay, statut callback.
- `tenant_azure_integrations` : statut de consentement et de verification RBAC par tenant Microsoft.
- `tenant_azure_scopes` enrichie : source, statut, display name, metadata, verified_at.

La logique cible est : la cle API identifie le tenant Bevoac, Microsoft identifie le tenant client, Azure Management prouve les subscriptions accessibles, puis l'allowlist backend autorise uniquement ces scopes.


## Addendum V4 - corrections de cohérence et sécurité

La V4 aligne le code, l'IaC et la documentation :

- correction du bloc Terraform `admin-api-secret` dans `container-apps.tf` ;
- `ONBOARDING_STATE_SECRET` obligatoire en production ;
- callback onboarding renforcé par vérification de l'`api_key_id` stocké en session ;
- inférence de `ONBOARDING_REDIRECT_URI` désactivée en production ;
- runbook complet livré en Markdown et Word ;
- sources Mermaid V4 livrées pour architecture, onboarding, cycle de scan et isolation tenant.
