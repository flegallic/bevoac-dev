# BEVOAC V6.1.1 - Runbook Production Ready - Client B2B

Installation from scratch, onboarding Azure, API SaaS B2B, worker, billing, PDF KPI, APIM, outbox, sécurité, alerting, rétention et validation client/admin

**Version**: V6.1.1 - API image v6.1.2 / Worker image v6.1.2

**Document contrôlé - Ne pas diffuser avec secrets ou clés API réels**

## Sommaire fonctionnel
- 0. Contrôle documentaire et décisions de consolidation
- 1. Résumé exécutif et positionnement client
- 2. Architecture cible et schémas
- 3. Prérequis poste admin et conventions
- 4. Variables, nommage et configuration
- 5. Microsoft Entra App Registration et OIDC admin
- 6. Déploiement Terraform from scratch
- 7. Build, push et mise à jour des images
- 8. PostgreSQL, migrations versionnées, contrôles schéma et backfill
- 9. Gestion des tenants, plans et API keys
- 10. Onboarding Azure sécurisé
- 11. Autorisation de cibles et anti cross-customer abuse
- 12. Catalogue complet des URLs API
- 13. Commandes client / intégrateur
- 14. Commandes administrateur Bevoac
- 15. Billing, quotas, backpressure et limites ressources
- 16. Rapport PDF et JSON exhaustif V6.1.1
- 17. Catalogue des modules et ressources scannées
- 18. Worker, Service Bus sessions, DLQ et KEDA
- 19. Outbox publisher dédié V6.1.1
- 20. APIM et gateway B2B
- 21. Sécurité code, données client et écosystème Azure
- 22. Observabilité, alertes et supervision
- 23. Rétention, RGPD et données de scan
- 24. Tests client/admin V6.1.1 de bout en bout
- 25. Tests de charge multi-tenant
- 26. Troubleshooting structuré des erreurs rencontrées
- 27. Maintenance Azure, ACR et Docker
- 28. Scénario de démonstration client from scratch
- 29. Fonctionnalités non incluses, risques acceptés et roadmap
- 30. Checklist readiness production B2B
- 31. Annexe SQL opérateur utile
- 32. Matrice d’alignement code / documentation
- 33. Inventaire documentaire et politique d’archives
- 34. Annexes Mermaid et sources
- 35. Conclusion

## 0. Contrôle documentaire et décisions de consolidation
Cette édition reprend volontairement la profondeur du runbook V4.2/V5.3, qui reste la base la plus opérationnelle pour l'installation from scratch, les schémas, les commandes et la démonstration client B2B. Elle ajoute toutes les évolutions prouvées jusqu'à V6.1.1 sans supprimer les chapitres historiques utiles.

| Source | Décision V6.1.1 | Raison |
| --- | --- | --- |
| Runbook V4.2 / V5.3 rebase | Repris comme socle principal | Document le plus complet sur procédures from scratch, démonstration B2B, sécurité, worker, billing, PDF et troubleshooting. |
| Documentation V5.2/V5.3 | Conservée et mise à jour | Idempotence, outbox, APIM, alerting, rétention, tenant guardrails et risques résiduels. |
| Ajouts V6.0 | Intégrés dans les modules et le reporting | KPI engine, nouveaux modules Azure, evidenceMetadata, kpiScorecard. |
| Patchs V6.1/V6.1.1 | Intégrés dans opérations et validations | Backfill billing, PDF KPI Scorecard, Action Group receiver, executionStatus SUCCESS. |

### 0.1 Règles documentaires

- Tout élément non livré ou non prouvé est marqué : non inclus, roadmap, POC ou risque accepté.
- Les commandes ouvrant temporairement Key Vault ou PostgreSQL au public sont POC/diagnostic uniquement.
- Le runbook doit être mis à jour à chaque changement de route API, contrat message, migration DB, module worker ou variable Terraform.
- Le discours client autorisé est : production-ready pour pilote avancé ou production contrôlée avec risques acceptés.
- Le discours interdit est : enterprise-certified sans pentest, charge large, runbook incident, décision RLS/compensating controls et preuves formelles.

### 0.2 Changements majeurs depuis V5.3

| Axe | V5.3 | V6.1.1 actif |
| --- | --- | --- |
| Version | API/worker 5.3.0-production-acceptance | API image v6.1.2, worker image v6.1.2. |
| Contrat scan | 2026-05-06-production-hardening-v5 | 2026-06-01-kpi-modules-v6 ; inchangé en V6.1.1. |
| Modules | web, Entra, infra Azure historiques | Ajout exposure_map, diagnostic_coverage, encryption_coverage, azure_rbac_exposure, private_link_coverage, policy_compliance, identity_admin_posture. |
| Reporting | PDF findings/remediation/evidence | PDF conserve l’ancien format et ajoute 1.6 KPI Scorecard avec IDs KPI. |
| Evidence metadata | executionStatus parfois UNKNOWN | webSecurity.evidenceMetadata.executionStatus=SUCCESS sur scans web V6.1.1. |
| Billing historique | Anciens DONE/RESERVED possibles | Backfill contrôlé dry-run/apply, dry-run final candidates=0. |
| Alerting | Action Group possible sans receiver | Receiver email support@dotcloud.fr validé. |

## 1. Résumé exécutif et positionnement client
Bevoac est un control plane SaaS B2B d'audit sécurité cloud et web. L'API reçoit les demandes de scan, authentifie le client par API key, dérive le tenant Bevoac côté serveur, valide les allowlists web/Azure, applique quotas et backpressure, réserve le billing, enregistre l'idempotence, écrit un événement outbox et déclenche un traitement asynchrone via Service Bus et worker.

Les résultats sont persistés en JSON complet, exposés via API, synthétisés dans un PDF orienté findings/remediation/evidence et enrichis par une KPI Scorecard lisible par un CTO ou un RSSI. L'exhaustivité brute reste dans le JSON ; le PDF est un livrable exécutif et technique borné.

| Axe | Implémentation V6.1.1 | Valeur B2B |
| --- | --- | --- |
| Multi-tenant | Tenant dérivé de l’API key ; rejet tenantId/customerId body ; guardrails DB. | Réduit le risque de cross-customer abuse. |
| Onboarding Azure | Session courte, state HMAC, admin consent Microsoft, vérification RBAC/subscriptions. | Prouve le consentement client et alimente l’allowlist. |
| Idempotence | Idempotency-Key optionnelle ou génération serveur. | Retries réseau sûrs pour intégrateurs. |
| Outbox | scan.requested persiste dans outbox_events avant publication. | Évite scans orphelins et fiabilise la queue. |
| Worker | Service Bus sessions, scan_attempts, retry/backoff, timeouts, KEDA. | Traitement asynchrone robuste et traçable. |
| KPI V6 | kpis[], coverage, evidenceMetadata, kpiScorecard. | Rend la posture lisible et exploitable en comité client. |
| PDF | Findings/remediation/evidence + 1.6 KPI Scorecard. | Rapport professionnel, présentable client. |
| Billing | RESERVED -> CONSUMED / REFUNDED + ledger. | Facturation défendable commercialement. |
| Ops | APIM, alerting receiver, retention job, DLQ, backfill historique. | Exploitation crédible en contexte B2B. |

> **Note**: Formulation client recommandée : Bevoac V6.1.1 est une API B2B Azure-first production-ready pour pilote avancé ou production contrôlée, avec risques résiduels documentés et acceptés.

> **Note**: Formulations interdites sans preuves : enterprise-certified, conformité réglementaire complète, zéro risque tenant, pentest-validated, multi-cloud runtime livré.

## 2. Architecture cible et schémas
La conception sépare le control plane Bevoac et les environnements clients. Bevoac héberge API, worker, outbox publisher, base PostgreSQL, Service Bus, Key Vault, APIM optionnel, Log Analytics, alertes et retention job. Les clients conservent leurs tenants Microsoft et subscriptions Azure ; Bevoac n'agit que sur des scopes consentis et vérifiés.

**Schéma 1 - Architecture cible Bevoac V6.1.1 B2B Azure-first**
![Schéma 1 - Architecture cible Bevoac V6.1.1 B2B Azure-first](diagrams/architecture_v6_1_1.png)

**Schéma 2 - Onboarding Azure sécurisé**
![Schéma 2 - Onboarding Azure sécurisé](diagrams/onboarding_azure_v6_1_1.png)

**Schéma 3 - Cycle de vie scan V6.1.1**
![Schéma 3 - Cycle de vie scan V6.1.1](diagrams/scan_lifecycle_v6_1_1.png)

**Schéma 4 - Isolation tenant et guardrails**
![Schéma 4 - Isolation tenant et guardrails](diagrams/tenant_isolation_v6_1_1.png)

**Schéma 5 - Outbox publisher dédié**
![Schéma 5 - Outbox publisher dédié](diagrams/outbox_publisher_v6_1_1.png)

**Schéma 6 - Modes APIM V6.1.1**
![Schéma 6 - Modes APIM V6.1.1](diagrams/apim_modes_v6_1_1.png)

**Schéma 7 - Terraform et Key Vault privé**
![Schéma 7 - Terraform et Key Vault privé](diagrams/terraform_keyvault_v6_1_1.png)

**Schéma 8 - Observabilité, rétention, DLQ et alerting**
![Schéma 8 - Observabilité, rétention, DLQ et alerting](diagrams/observability_v6_1_1.png)

**Schéma 9 - Déploiement from scratch V6.1.1**
![Schéma 9 - Déploiement from scratch V6.1.1](diagrams/deployment_v6_1_1.png)

**Schéma 10 - Reporting JSON/PDF V6.1.1**
![Schéma 10 - Reporting JSON/PDF V6.1.1](diagrams/reporting_v6_1_1.png)

### 2.1 Lecture simple de l’architecture

```bash
Client / API key
 -> APIM optionnel ou API directe
 -> API Fastify /v1/scans
 -> PostgreSQL : scan PENDING + billing RESERVED + idempotency + outbox_events
 -> Outbox publisher dédié : publication Service Bus
 -> Service Bus scan-jobs : sessions tenant + DLQ
 -> Worker Container Apps : attempts + modules + retry/backoff + KPI engine
 -> PostgreSQL : scan_results + DONE/FAILED + CONSUMED/REFUNDED
 -> Client : GET /v1/scans/{scanId} ou GET /v1/scans/{scanId}/pdf
```

### 2.2 Composants Azure

| Composant | Rôle | Point de vigilance sécurité |
| --- | --- | --- |
| Resource Group | Périmètre logique de l’environnement Bevoac. | Un environnement par dev/staging/prod ; tags obligatoires. |
| Virtual Network / Subnets | Réseau Container Apps, private endpoints et egress. | DNS privé et routage validés avant production stricte. |
| ACR | Stockage images API/worker. | Compte admin désactivé ; pull via Managed Identity. |
| Container Apps API | Control plane HTTP. | Ingress HTTPS ; auth API key ; rate limit. |
| Container App outbox | Publisher transactionnel. | Pas d’ingress ; une seule replica sauf revue de concurrence. |
| Container Apps worker | Exécution scans. | Pas d’ingress ; sessions tenant ; identité managée. |
| Service Bus scan-jobs | Découplage API/worker. | Sessions, DLQ, RBAC minimum, TTL. |
| PostgreSQL Flexible Server | Source de vérité métier. | SSL, private endpoint, guardrails tenant. |
| Key Vault | Secrets runtime. | RBAC, public access fermé en production. |
| APIM | Gateway optionnelle. | Double-auth ou Bevoac-only documenté. |
| Log Analytics / Monitor | Logs et métriques. | Alertes DLQ/backlog/PG et receiver email. |

## 3. Prérequis poste admin et conventions
Le poste opérateur doit être propre, connecté au bon tenant Azure et capable de construire/pousser les images. En contexte B2B, chaque commande doit produire une preuve observable.

| Outil | Usage | Validation |
| --- | --- | --- |
| Azure CLI | Connexion, outputs, logs, Container Apps, Service Bus, APIM, ACR. | az --version ; az account show. |
| Terraform >= 1.6 | Provisioning IaC. | terraform version ; terraform validate. |
| Docker / buildx | Build/push API et worker. | docker version ; docker buildx version. |
| Node.js LTS | Scripts DB, tests, migrations. | node -v ; npm -v. |
| jq | Lecture JSON. | jq --version. |
| psql | Contrôles SQL opérateur. | psql --version. |
| k6 | Charge multi-tenant. | k6 version. |
| poppler/pdftotext | Validation texte PDF. | pdftotext -v. |
| VPN / VM / runner privé | Accès Key Vault/PostgreSQL privés. | nslookup, az keyvault secret show, psql depuis réseau autorisé. |

**Commandes de validation poste admin**
```bash
az login --tenant <TENANT_BEVOAC_DEPLOIEMENT>
az account set --subscription <SUBSCRIPTION_BEVOAC_CONTROL_PLANE>
az account show -o table
terraform version
docker version
node -v
npm -v
jq --version
psql --version
k6 version
pdftotext -v
```

> **Note**: Règle B2B : ne mélange pas deux environnements dans la même session shell. Exporte les variables par environnement et masque les secrets dans toutes les preuves.

## 4. Variables, nommage et configuration
| Variable IaC | Valeur cible | Usage |
| --- | --- | --- |
| tenant_id | <tenant de déploiement> | Tenant Azure du control plane. |
| prefix | bevoac-prod / bevoac-prod | Préfixe ressources. |
| environment | poc/staging/prod | Contexte runtime. |
| deploy_container_apps | false puis true | Bootstrap sans images puis activation apps. |
| api_image | <acr>/bevoac-api-enterprise:v6.1.2 | Image API validée V6.1. |
| worker_image | <acr>/bevoac-worker-enterprise:v6.1.2 | Image worker hotfix executionStatus. |
| enable_dedicated_outbox_publisher | true | Découple publication Service Bus de l’API. |
| apim_subscription_required | true ou false | Mode d’auth APIM. |
| enable_service_bus_sessions | true | Fair scheduling tenant. |
| enable_private_endpoints | true en prod | Key Vault/PostgreSQL privés. |
| monitor_action_group_id | <action group id> | Création alertes Azure Monitor. |
| enable_retention_scheduler | true | Container Apps Job rétention. |

| Variable runtime | Valeur cible | Commentaire |
| --- | --- | --- |
| NODE_ENV | production | Active les exigences strictes. |
| PG_SSL_MODE | verify-full | SSL PostgreSQL. |
| SERVICEBUS_AUTH_MODE | managed_identity | Connection string local/staging seulement. |
| SERVICEBUS_FQ_NAMESPACE | <sb>.servicebus.windows.net | FQDN Service Bus. |
| SERVICEBUS_SESSIONS_ENABLED | true | Doit correspondre à la queue. |
| OUTBOX_PUBLISHER_ENABLED | false si publisher dédié | Désactive publisher API quand dédié activé. |
| OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST | false si publisher dédié | Évite double publication immediate. |
| ADMIN_AUTH_MODE | oidc | Admin enterprise. |
| ONBOARDING_STATE_SECRET | 64+ chars | Distinct du secret admin. |
| API_PUBLIC_BASE_URL | https://<api> | Base publique stable. |
| PDF_GENERATION_TIMEOUT_MS | 20000+ | Timeout PDF. |
| MAX_RESULT_JSON_BYTES | 8388608 ou plus selon plan | Borne résultats. |

**Variables communes de recette**
```bash
export RESOURCE_GROUP="$(terraform output -raw resource_group_name)"
export API_BASE_URL="$(terraform output -raw api_public_base_url_effective)"
export APIM_URL="$(terraform output -raw apim_gateway_url)"
export API_CONTAINER_APP="$(terraform output -raw api_container_app_name)"
export WORKER_CONTAINER_APP="$(terraform output -raw worker_container_app_name)"
export OUTBOX_CONTAINER_APP="$(terraform output -raw outbox_publisher_container_app_name)"
export SERVICEBUS_NAMESPACE="$(terraform output -raw service_bus_namespace_short)"
export SERVICEBUS_QUEUE_NAME="$(terraform output -raw service_bus_queue_name)"
export RETENTION_JOB_NAME="$(terraform output -raw retention_job_name)"
export MONITOR_ACTION_GROUP_ID="$(terraform output -raw monitor_action_group_id)"
```

## 5. Microsoft Entra App Registration et OIDC admin
Le frontend ne fabrique pas l’URL Microsoft. L’API démarre l’onboarding, crée une session courte, signe le state HMAC et contrôle le callback Microsoft. success.html est seulement la page finale côté frontend ; la redirect URI Microsoft est le callback API.

| Paramètre | Valeur V6.1.1 | Commentaire |
| --- | --- | --- |
| Supported account types | Accounts in any organizational directory | Multi-tenant client. |
| Redirect URI Web | https://<api_fqdn>/v1/onboarding/azure/callback | Callback API, pas success.html. |
| Client secret | Key Vault | Rotation contrôlée ; jamais dans Git. |
| Graph permissions | Moindre privilège | Selon modules Entra réellement activés. |
| Azure RBAC | Reader / Security Reader ou rôles ciblés | Sur subscriptions ou management groups audités. |
| Admin API OIDC | Entra | Shared secret uniquement staging/break-glass. |

**Vérifier issuer/audience/roles du token admin**
```bash
ADMIN_TOKEN=$(az account get-access-token --resource "api://<admin-app-client-id>" --query accessToken -o tsv)
export ADMIN_TOKEN
python3 - <<'PY'
import os, json, base64
payload=os.environ["ADMIN_TOKEN"].split(".")[1]
payload += "=" * (-len(payload) % 4)
data=json.loads(base64.urlsafe_b64decode(payload.encode()))
print(json.dumps({k:data.get(k) for k in ["aud","iss","roles","scp","tid","upn"]}, indent=2))
PY
```

| Cas onboarding | Action client attendue | Statut attendu |
| --- | --- | --- |
| Consentement Graph OK + aucun RBAC Azure | Attribuer Reader/Security Reader sur subscription ou management group. | ACTION_REQUIRED / NEEDS_RBAC. |
| Consentement Graph OK + RBAC subscription | Aucune action additionnelle. | COMPLETED / ACTIVE / VERIFIED. |
| Consentement refusé ou erreur state | Relancer onboarding depuis frontend/API. | FAILED / error. |
| Client limite certaines subscriptions | Accorder RBAC seulement sur les scopes choisis. | success avec subscriptionCount limité. |

## 6. Déploiement Terraform from scratch
La séquence recommandée reste en deux temps : créer le socle Azure sans Container Apps si les images n’existent pas, puis construire/pousser les images, lancer les migrations DB, activer API/worker/outbox/APIM/retention et appliquer Terraform final.

**Bootstrap infrastructure**
```bash
cd bevoac-iac-enterprise
cp terraform.tfvars.example terraform.tfvars
# Renseigner tenant_id, prefix, environment, OIDC admin, Microsoft app, private endpoints.
terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=tfplan.bootstrap
terraform apply tfplan.bootstrap
rm -f tfplan.bootstrap
```

| Étape | Action | Preuve attendue |
| --- | --- | --- |
| 1 | Configurer deploy_container_apps=false si ACR est vide. | Le plan ne référence pas d’image inexistante. |
| 2 | Appliquer le socle Azure. | ACR, PostgreSQL, Service Bus, Key Vault, Log Analytics existent. |
| 3 | Build/push API et worker. | Tags visibles dans ACR. |
| 4 | Exécuter migrations DB. | schema_migrations et tables critiques OK. |
| 5 | Activer deploy_container_apps=true avec images taguées. | Plan Terraform propre. |
| 6 | Déployer API, worker, outbox, APIM, retention. | Container Apps et outputs disponibles. |
| 7 | Tester health, scans, PDF, DLQ. | HTTP 200, scan DONE, DLQ 0. |

### 6.1 Outputs à conserver

```bash
terraform output -raw resource_group_name
terraform output -raw acr_login_server
terraform output -raw api_public_base_url_effective
terraform output -raw api_container_app_name
terraform output -raw worker_container_app_name
terraform output -raw outbox_publisher_container_app_name
terraform output -raw service_bus_namespace
terraform output -raw service_bus_namespace_short
terraform output -raw service_bus_queue_name
terraform output -raw apim_gateway_url
terraform output -raw apim_subscription_required
terraform output -raw retention_job_name
terraform output -raw key_vault_name
terraform output -raw postgres_fqdn
```

### 6.2 Key Vault privé et Terraform

> **Note**: Production stricte : Terraform doit être exécuté depuis un runner privé, une VM admin dans le VNet ou un poste connecté via VPN/ExpressRoute. Terraform depuis un Mac hors VNet peut échouer en ForbiddenByConnection pendant le refresh des secrets.

**Exception POC/diagnostic uniquement**
```bash
export RESOURCE_GROUP="$(terraform output -raw resource_group_name)"
export KEY_VAULT_NAME="$(terraform output -raw key_vault_name)"
export MY_IP="$(curl -s ifconfig.me)"
az keyvault update --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --public-network-access Enabled
az keyvault network-rule add --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --ip-address "$MY_IP/32"
az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name pg-password --query id -o tsv
terraform plan -out=tfplan
terraform apply tfplan
az keyvault update --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --public-network-access Disabled
```

## 7. Build, push et mise à jour des images
> **Note**: Règle image : ne jamais utiliser latest en présentation client ou production contrôlée. Utiliser un tag immutable ou explicitement versionné.

**Connexion ACR**
```bash
cd bevoac-iac-enterprise
export ACR_LOGIN_SERVER="$(terraform output -raw acr_login_server)"
export ACR_NAME="$(echo "$ACR_LOGIN_SERVER" | cut -d. -f1)"
az acr login --name "$ACR_NAME"
```

**Build/push API V6.1**
```bash
cd ../bevoac-api-enterprise
npm install
npm run check
npm test
docker build --platform linux/amd64 -t "$ACR_LOGIN_SERVER/bevoac-api-enterprise:v6.1.2" .
docker push "$ACR_LOGIN_SERVER/bevoac-api-enterprise:v6.1.2"
```

**Build/push worker V6.1.2**
```bash
cd ../bevoac-worker-enterprise
npm install
npm run check
npm test
docker build --platform linux/amd64 -t "$ACR_LOGIN_SERVER/bevoac-worker-enterprise:v6.1.2" .
docker push "$ACR_LOGIN_SERVER/bevoac-worker-enterprise:v6.1.2"
```

**Aligner Terraform**
```bash
# terraform.tfvars
api_image    = "acrbevoacpoc.azurecr.io/bevoac-api-enterprise:v6.1.2"
worker_image = "acrbevoacpoc.azurecr.io/bevoac-worker-enterprise:v6.1.2"
```

**Plan/apply final**
```bash
cd bevoac-iac-enterprise
terraform fmt -recursive
terraform validate
bash scripts/static-hardening-check.sh
terraform plan -out=tfplan-v6-1-1
terraform show -no-color tfplan-v6-1-1 | grep "will be destroyed" || true
terraform apply tfplan-v6-1-1
```

**Vérifier les images réellement déployées**
```bash
az containerapp show --resource-group "$RESOURCE_GROUP" --name "$API_CONTAINER_APP" --query "properties.template.containers[0].image" -o tsv
az containerapp show --resource-group "$RESOURCE_GROUP" --name "$WORKER_CONTAINER_APP" --query "properties.template.containers[0].image" -o tsv
az containerapp show --resource-group "$RESOURCE_GROUP" --name "$OUTBOX_CONTAINER_APP" --query "properties.template.containers[0].image" -o tsv
```

## 8. PostgreSQL, migrations versionnées, contrôles schéma et backfill
V6.1.1 privilégie les migrations versionnées via schema_migrations. init-db.js peut rester utile en bootstrap historique, mais le runbook client doit utiliser npm run migrate-db pour les évolutions contrôlées.

**Validation API et schéma**
```bash
cd bevoac-api-enterprise
npm install
npm run check
npm test
npm run migrate-db
npm run check:tenant-isolation
```

| Commande | Attendu |
| --- | --- |
| npm run check | Dépendances runtime, syntaxe et contrats API/worker synchronisés. |
| npm test | Tests unitaires/intégration OK. V6.1.1 attend 13/13 côté API. |
| npm run migrate-db | Migrations appliquées ou SKIP si déjà appliquées. |
| npm run check:tenant-isolation | Tenant isolation integrity checks passed. |

**Contrôles SQL post-migration**
```bash
SELECT version, name, applied_at FROM schema_migrations ORDER BY version;
SELECT to_regclass('public.outbox_events');
SELECT to_regclass('public.scan_results');
SELECT to_regclass('public.scan_attempts');
SELECT column_name FROM information_schema.columns WHERE table_name='scans' AND column_name IN ('billing_state','billing_state_updated_at','billing_error');
SELECT conname FROM pg_constraint WHERE conname IN ('valid_scan_billing_state','valid_ledger_event_type');
SELECT * FROM tenant_isolation_violations LIMIT 20;
```

### 8.1 Backfill billing historique V6.1

Le backfill corrige les anciens scans terminés DONE mais restés RESERVED. Il est safe-by-default : dry-run par défaut, mutation uniquement avec --apply.

```bash
npm run backfill:billing:dry-run
# Attendu avant correction historique : candidates=8 dans l’environnement validé
npm run backfill:billing -- --apply --before 2026-06-01
# Attendu : [APPLY] ... "finalBillingState":"CONSUMED", "eventType":"scan_consumed"
npm run backfill:billing:dry-run
# Attendu final : candidates=0
```

> **Note**: Ne jamais lancer --apply sans dry-run relu. Si PostgreSQL retourne une erreur SQL, le script doit rollback et être corrigé avant nouvel apply.

## 9. Gestion des tenants, plans et API keys
Un tenant Bevoac représente un client B2B. Une API key appartient à un tenant, et toutes les opérations client sont résolues depuis cette clé. Le client ne fournit jamais tenantId/customerId dans les bodies de scan.

**Créer un tenant et une cible web autorisée**
```bash
cd bevoac-api-enterprise
node scripts/create-tenant.js "DEMO_CLIENT_SAS" standard primary
node scripts/register-web-target.js <BEVOAC_TENANT_ID> https://www.example.com
```

| Plan | Quota mensuel | Scans actifs | Limite ressources infra | PAYG |
| --- | --- | --- | --- | --- |
| free | 30 | 1 | 10 | Non |
| standard | 2500 | 3 | 500 | Non |
| business | 10000 | 10 | 2500 | Non |
| payg | variable | 10 | Selon config | Oui |

- La clé brute est affichée une seule fois à la création.
- La clé doit être stockée dans un coffre de secrets.
- Toute clé visible en recette, capture, ticket ou échange doit être révoquée et régénérée avant usage client.
- Les clés peuvent être labellisées par usage : portail, intégrateur, support, automation.

**Vérifications opérateur**
```bash
SELECT id, company_name, plan_code, is_active, created_at FROM tenants ORDER BY created_at DESC;
SELECT tenant_id, label, is_active, expires_at, last_used_at, created_at FROM api_keys ORDER BY created_at DESC;
```

## 10. Onboarding Azure sécurisé
Le flux onboarding prouve que Bevoac ne scanne pas librement des subscriptions arbitraires. Le périmètre Azure provient d’un consentement Microsoft, de RBAC vérifié et de tables tenant_azure_scopes côté Bevoac.

**Démarrer l’onboarding**
```bash
export API_BASE_URL="https://<api_fqdn>"
export BEVOAC_API_KEY="biv_live_xxx"
curl -s -X POST "$API_BASE_URL/v1/onboarding/azure/start"   -H "Authorization: Bearer $BEVOAC_API_KEY"   -H "Content-Type: application/json"   -d '{}' | jq .
```

**Statut et revérification RBAC**
```bash
curl -s "$API_BASE_URL/v1/onboarding/azure/status"   -H "Authorization: Bearer $BEVOAC_API_KEY" | jq .

curl -s -X POST "$API_BASE_URL/v1/onboarding/azure/verify"   -H "Authorization: Bearer $BEVOAC_API_KEY"   -H "Content-Type: application/json"   -d '{"microsoftTenantId":"<tenant_microsoft_client>"}' | jq .
```

| État | Signification | Action |
| --- | --- | --- |
| COMPLETED / ACTIVE | Consentement et RBAC valides. | Peut lancer scans infra. |
| ACTION_REQUIRED / NEEDS_RBAC | Consentement OK mais RBAC insuffisant. | Attribuer Reader/Security Reader. |
| FAILED / ERROR | Erreur state, consentement, token ou RBAC. | Relancer onboarding et vérifier logs. |

## 11. Autorisation de cibles et anti cross-customer abuse
- Le client ne fournit jamais tenantId/customerId dans le body.
- Les hosts web doivent exister dans tenant_web_targets.
- Les subscriptions Azure doivent exister dans tenant_azure_scopes avec status VERIFIED et is_active true.
- Les lectures de scans doivent retourner 404 pour tout scan d’un autre tenant.
- Les résultats, rapports PDF et billing doivent être filtrés par tenant_id.

**Tests anti cross-customer**
```bash
# tenantId body interdit -> 400
curl -s -o /tmp/tenant-in-body.json -w "%{http_code}
"   -X POST "$API_BASE_URL/v1/scans"   -H "Authorization: Bearer $BEVOAC_API_KEY"   -H "Content-Type: application/json"   -d '{"tenantId":"00000000-0000-4000-8000-000000000000","cloudProvider":"azure","scanProfile":"web","modules":["web"],"azure":{"targetUrl":"https://example.com"}}'

# lecture croisée -> 404
curl -s -o /tmp/cross.json -w "%{http_code}
"   "$API_BASE_URL/v1/scans/$SCAN_ID_A"   -H "Authorization: Bearer $BEVOAC_API_KEY_TENANT_B"
```

## 12. Catalogue complet des URLs API
| Méthode | Endpoint | Auth | Rôle |
| --- | --- | --- | --- |
| GET | /v1/health | Publique ou gateway | Santé API. |
| POST | /v1/scans | API key | Créer un scan. |
| GET | /v1/scans | API key | Lister scans tenant. |
| GET | /v1/scans/:scanId | API key | Lire statut/résultat. |
| GET | /v1/scans/:scanId/pdf | API key | Générer rapport PDF. |
| GET | /v1/billing/overview | API key | Vue billing tenant. |
| GET | /v1/billing/current-month/scans | API key | Détails scans du mois. |
| POST | /v1/onboarding/azure/start | API key | Démarrer admin consent. |
| GET | /v1/onboarding/azure/callback | State HMAC | Callback Microsoft. |
| GET | /v1/onboarding/azure/status | API key | Statut onboarding. |
| POST | /v1/onboarding/azure/verify | API key | Revérification RBAC. |
| GET | /v1/admin/billing/overview | OIDC admin | Vue globale. |
| GET | /v1/admin/billing/tenants/:tenantId/ledger | OIDC admin | Ledger tenant. |
| POST | /v1/admin/billing/close-month | OIDC admin | Clôture mensuelle. |

| HTTP | Cause probable | Action |
| --- | --- | --- |
| 400 | Payload invalide, tenantId body, URL non HTTPS/private. | Corriger payload. |
| 401 | API key absente/invalide/expirée ou APIM key manquante selon mode. | Vérifier Authorization et APIM. |
| 403 | Target non autorisée ou scope Azure non verified. | Onboarding/register target. |
| 404 | Scan inexistant ou autre tenant. | Vérifier tenant/API key. |
| 409 | Idempotency key conflictuelle. | Rejouer avec bonne clé. |
| 429 | Quota ou active scan limit. | Attendre ou upgrader plan. |
| 500 | Erreur serveur. | Logs API/worker/outbox. |

## 13. Commandes client / intégrateur
**Variables client**
```bash
export API_BASE_URL="https://<api-ou-apim>"
export BEVOAC_API_KEY="biv_live_xxx"
export TARGET_URL="https://www.example.com"
echo "BEVOAC_API_KEY_PREFIX=${BEVOAC_API_KEY:0:8}******"
```

**Tests auth**
```bash
curl -i "$API_BASE_URL/v1/health"
# Attendu: HTTP 200

curl -s -o /tmp/no-auth.json -w "%{http_code}
" "$API_BASE_URL/v1/scans"
# Attendu: 401

curl -s -o /tmp/bad-auth.json -w "%{http_code}
" "$API_BASE_URL/v1/scans"   -H "Authorization: Bearer invalid-key"
# Attendu: 401
```

**Créer un scan web avec idempotence serveur**
```bash
RESP=$(curl -s -X POST "$API_BASE_URL/v1/scans"   -H "Authorization: Bearer $BEVOAC_API_KEY"   -H "Content-Type: application/json"   -d '{"cloudProvider":"azure","scanProfile":"web","modules":["web"],"azure":{"targetUrl":"https://example.com"}}')
echo "$RESP" | jq .
export SCAN_ID="$(echo "$RESP" | jq -r .scanId)"
export IDEM="$(echo "$RESP" | jq -r .idempotencyKey)"
```

**Rejeu idempotent**
```bash
RESP2=$(curl -s -X POST "$API_BASE_URL/v1/scans"   -H "Authorization: Bearer $BEVOAC_API_KEY"   -H "Content-Type: application/json"   -H "Idempotency-Key: $IDEM"   -d '{"cloudProvider":"azure","scanProfile":"web","modules":["web"],"azure":{"targetUrl":"https://example.com"}}')
echo "$RESP2" | jq '{scanId,idempotencyKeySource,idempotentReplay,billingState}'
# Attendu: même scanId, idempotentReplay=true
```

**Suivre un scan**
```bash
for i in {1..60}; do
  curl -s "$API_BASE_URL/v1/scans/$SCAN_ID?includeResult=false"     -H "Authorization: Bearer $BEVOAC_API_KEY"     | jq '{scanId,status,billingState,errorMessage,resultSummary}'
  sleep 5
done
```

## 14. Commandes administrateur Bevoac
**Variables admin Azure**
```bash
export RESOURCE_GROUP="$(terraform output -raw resource_group_name)"
export API_APP_NAME="$(terraform output -raw api_container_app_name)"
export WORKER_APP_NAME="$(terraform output -raw worker_container_app_name)"
export OUTBOX_APP_NAME="$(terraform output -raw outbox_publisher_container_app_name)"
```

**Logs API / worker / outbox**
```bash
az containerapp logs show --resource-group "$RESOURCE_GROUP" --name "$API_APP_NAME" --tail 100
az containerapp logs show --resource-group "$RESOURCE_GROUP" --name "$WORKER_APP_NAME" --tail 100
az containerapp logs show --resource-group "$RESOURCE_GROUP" --name "$OUTBOX_APP_NAME" --tail 100
```

**Service Bus DLQ/backlog**
```bash
export SERVICEBUS_NAMESPACE="$(terraform output -raw service_bus_namespace_short)"
export SERVICEBUS_QUEUE_NAME="$(terraform output -raw service_bus_queue_name)"
az servicebus queue show   --resource-group "$RESOURCE_GROUP"   --namespace-name "$SERVICEBUS_NAMESPACE"   --name "$SERVICEBUS_QUEUE_NAME"   --query "{active:countDetails.activeMessageCount,deadLetter:countDetails.deadLetterMessageCount,transferDeadLetter:countDetails.transferDeadLetterMessageCount,requiresSession:requiresSession}"   -o json
```

**Alertes Azure Monitor via API compatible**
```bash
export METRIC_ALERT_API_VERSION="2024-03-01-preview"
export AZURE_SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
az rest --method get   --url "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Insights/metricAlerts?api-version=$METRIC_ALERT_API_VERSION"   --query "value[].{name:name,enabled:properties.enabled,severity:properties.severity}"   -o table
```

## 15. Billing, quotas, backpressure et limites ressources
Le modèle V6.1.1 sépare réservation et consommation. La création d’un scan écrit scan_reserved et billing_state=RESERVED. Le worker finalise en scan_consumed si le scan réussit ou scan_refunded si un échec contrôlé survient.

| Moment | scan.status | billing_state | Ledger attendu |
| --- | --- | --- | --- |
| Création | PENDING | RESERVED | scan_reserved |
| Traitement | IN_PROGRESS | RESERVED | scan_reserved |
| Succès | DONE | CONSUMED | scan_reserved + scan_consumed |
| Échec contrôlé | FAILED | REFUNDED | scan_reserved + scan_refunded |
| Historique V5 | DONE | RESERVED | Corrigé par backfill V6.1 vers CONSUMED |

**Preuves SQL billing**
```bash
SELECT scan_id, event_type, billing_units, amount_eur_ht, metadata, recorded_at
FROM billing_usage_ledger
WHERE scan_id = '<SCAN_ID>'
ORDER BY recorded_at ASC;

SELECT id, status, billing_state, billing_state_updated_at, billing_error
FROM scans
WHERE id = '<SCAN_ID>';
```

### 15.1 Backpressure et quotas

- Les plans free, standard et business ont des quotas mensuels inclus et peuvent être hard-blocked.
- Les limites de scans actifs protègent la plateforme contre la monopolisation par un tenant.
- Le scan infra utilise resource preflight pour bloquer un tenant au-delà de sa limite de ressources.
- 429 est acceptable lorsque la backpressure est volontairement atteinte.

## 16. Rapport PDF et JSON exhaustif V6.1.1
Le JSON API reste la source exhaustive. Le PDF est un rendu borné et exploitable orienté findings/remediation/evidence. V6.1.1 conserve le format historique et ajoute la section 1.6 KPI Scorecard lorsque des KPI existent.

**JSON et PDF**
```bash
curl -s "$API_BASE_URL/v1/scans/$SCAN_ID?includeResult=true"   -H "Authorization: Bearer $BEVOAC_API_KEY" | jq .

curl -L "$API_BASE_URL/v1/scans/$SCAN_ID/pdf"   -H "Authorization: Bearer $BEVOAC_API_KEY"   -o /tmp/bevoac-report.pdf

file /tmp/bevoac-report.pdf
ls -lh /tmp/bevoac-report.pdf
```

| Contrôle PDF | Attendu |
| --- | --- |
| Statut scan | DONE ou FAILED avec résultat disponible. |
| Contenu | Contrôles exécutés, findings, ressources, evidence, recommandations. |
| KPI Scorecard | Section 1.6 présente avec ID KPI stable et libellé lisible. |
| Bornes | Timeout, taille JSON entrée, max findings, max evidence items. |
| Sécurité | Aucune clé, token ou secret dans le PDF. |

**Validation texte PDF local**
```bash
pdftotext bevoac-v6-1-1-web.pdf /tmp/bevoac-v6-1-1-web.txt
grep -nE "KPI Scorecard|WEB_SECURITY_CHECK_PASS_RATE|% contrôles web sans finding FAILED"   /tmp/bevoac-v6-1-1-web.txt
```

> **Note**: Si pdftotext est absent sur macOS : brew install poppler.

## 17. Catalogue des modules et ressources scannées
| Domaine | Module | Ce que le worker audite V6.1.1 | Ajout V6/V6.1.1 |
| --- | --- | --- | --- |
| Web | web | Headers HTTP, TLS, DNS, nmap, CSP, HSTS, ports exposés. | KPI WEB_SECURITY_CHECK_PASS_RATE ; executionStatus SUCCESS. |
| Entra ID | entra | Conditional Access, MFA, legacy auth, global admins, guest admins, utilisateurs inactifs, mots de passe anciens, risky sign-ins. | KPI MFA/global admins/inactive users/high-risk. |
| Identity admin | identity_admin_posture | Admins, MFA admin, admins dormants, guests privilégiés. | Nouveau module V6. |
| Storage | storage | Storage publics, secure transfer, private endpoints, blob public access, shared key, TLS, local users. | KPI stockage non-public, TLS, Shared Key, local users. |
| VMs | vms | Disques VM, managed identity, Trusted Launch, password auth Linux, ports admin exposés. | KPI encryption, trusted launch, managed identity. |
| NSG | nsg | Inbound permissif SSH/RDP, ports DB, wildcard. | KPI inbound exposure. |
| Key Vault | keyvault | Public access, soft delete, purge protection, RBAC auth, private endpoints. | KPI private/RBAC/purge/public. |
| Logs | logs | Log Analytics Workspace et rétention >= 90 jours. | KPI logging/retention. |
| Databases | db | Public network access, Allow Azure Services, TLS obsolète. | KPI private access/TLS/Allow Azure Services. |
| Governance | governance | Defender for Cloud, Azure Policy/security benchmark. | KPI Defender/policy coverage. |
| App Services | appservices | HTTPS only, FTP, Basic Auth publishing. | KPI HTTPS/basic auth/FTP. |
| FinOps | finops | Disques orphelins, IP publiques non attachées, App Service Plans vides, VMs stopped billed. | KPI cloud waste signals. |
| Entra B2B | entra_b2b | Guests dormants, guest admins, guests sans MFA. | KPI guest MFA/stale/admins. |
| Tags | tags | Ressources sans tags et tags obligatoires manquants. | Evidence remediation governance. |
| Exposure | exposure_map | Cartographie consolidée des expositions publiques. | Nouveau module V6. |
| Diagnostic | diagnostic_coverage | Couverture diagnostic settings ressources critiques. | Nouveau module V6. |
| Encryption | encryption_coverage | Signaux de chiffrement au repos. | Nouveau module V6. |
| RBAC | azure_rbac_exposure | Rôles Owner/Contributor/User Access Administrator larges. | Nouveau module V6. |
| Private Link | private_link_coverage | Couverture private endpoints PaaS. | Nouveau module V6. |
| Policy | policy_compliance | États Azure Policy non conformes. | Nouveau module V6. |

> **Note**: Multi-cloud : le runtime livré est Azure-first. AWS/GCP restent roadmap et ne doivent pas être présentés comme disponibles en V6.1.1.

## 18. Worker, Service Bus sessions, DLQ et KEDA
Le worker consomme la queue scan-jobs. Les sessions Service Bus séquentialisent les messages par tenant sans bloquer le parallélisme multi-tenant. Le worker valide le contrat message et dead-letter les messages invalides.

**Vérifier queue / DLQ**
```bash
az servicebus queue show   --resource-group "$RESOURCE_GROUP"   --namespace-name "$SERVICEBUS_NAMESPACE"   --name "$SERVICEBUS_QUEUE_NAME"   --query "{active:countDetails.activeMessageCount,deadLetter:countDetails.deadLetterMessageCount,transferDeadLetter:countDetails.transferDeadLetterMessageCount,requiresSession:requiresSession}"   -o json
```

| État | Signification | Action |
| --- | --- | --- |
| active > 0 | Backlog en attente. | Vérifier worker/outbox et scaling. |
| deadLetter > 0 | Message non traité ou contrat invalide. | Analyser DLQ, replay ou purge documentée. |
| requiresSession=false | Sessions tenant non activées. | Non conforme au modèle si sessions attendues. |
| PENDING ancien en DB | Outbox/publisher/worker en retard. | Vérifier outbox_events et logs publisher. |
| Could not find a replica | Worker scale-to-zero normal si queue vide. | Vérifier revision list et queue active. |

**Détecter les scans bloqués**
```bash
SELECT id, aggregate_id, tenant_id, status, attempts, last_error, created_at, updated_at
FROM outbox_events
WHERE status IN ('PENDING','FAILED','PROCESSING')
  AND created_at < NOW() - INTERVAL '10 minutes'
ORDER BY created_at ASC;

SELECT id, tenant_id, status, billing_state, created_at, updated_at
FROM scans
WHERE status = 'PENDING'
  AND created_at < NOW() - INTERVAL '10 minutes'
ORDER BY created_at ASC;
```

## 19. Outbox publisher dédié V6.1.1
Le publisher dédié lit les événements outbox, publie vers Service Bus et marque PUBLISHED ou FAILED avec backoff. L’API écrit toujours outbox_events dans la transaction de création du scan.

| Paramètre | Valeur cible | Rôle |
| --- | --- | --- |
| enable_dedicated_outbox_publisher | true | Déployer Container App dédiée. |
| outbox_publisher_min_replicas | 1 | Disponibilité nominale. |
| outbox_publisher_max_replicas | 1 | Éviter concurrence non revue. |
| OUTBOX_PUBLISHER_ENABLED API | false | Évite double publication par API. |
| OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST API | false | Évite publication immédiate API. |

**Validation publisher dédié**
```bash
terraform output -raw outbox_publisher_container_app_name
az containerapp logs show   --resource-group "$RESOURCE_GROUP"   --name "$(terraform output -raw outbox_publisher_container_app_name)"   --tail 100

SELECT status, COUNT(*) FROM outbox_events GROUP BY status ORDER BY status;
```

> **Note**: État nominal : après rattrapage worker, les événements récents doivent être majoritairement PUBLISHED, sans vieux PENDING/PROCESSING et sans FAILED persistant.

## 20. APIM et gateway B2B
APIM est optionnel mais recommandé pour un pilote B2B exposé à un intégrateur. Il fournit une gateway professionnelle, une URL stable, des logs gateway et un point de contrôle edge. L’auth Bevoac reste obligatoire via Authorization Bearer.

| Mode | Terraform | Headers client |
| --- | --- | --- |
| Double-auth | apim_subscription_required = true | Ocp-Apim-Subscription-Key + Authorization: Bearer <Bevoac API key> |
| Bevoac-only | apim_subscription_required = false | Authorization: Bearer <Bevoac API key> |

**Variables APIM**
```bash
cd bevoac-iac-enterprise
export APIM_URL="$(terraform output -raw apim_gateway_url)"
export APIM_SUBSCRIPTION_REQUIRED="$(terraform output -raw apim_subscription_required)"
export BEVOAC_API_KEY="biv_live_..."
export APIM_NAME="$(echo "$APIM_URL" | sed 's#https://##' | sed 's#.azure-api.net##')"
export AZURE_SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
export APIM_API_ID="bevoac-api"
export APIM_SUBSCRIPTION_ID="bevoac-client-test"
```

**Créer/récupérer la subscription APIM**
```bash
az rest --method put   --url "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ApiManagement/service/$APIM_NAME/subscriptions/$APIM_SUBSCRIPTION_ID?api-version=2022-08-01"   --body "{"properties":{"displayName":"Bevoac Client Test Subscription","scope":"/apis/$APIM_API_ID","state":"active","allowTracing":false}}"

export APIM_SUBSCRIPTION_KEY="$(az rest --method post   --url "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ApiManagement/service/$APIM_NAME/subscriptions/$APIM_SUBSCRIPTION_ID/listSecrets?api-version=2022-08-01"   --query primaryKey -o tsv)"
echo "${APIM_SUBSCRIPTION_KEY:0:6}******"
```

**Appels APIM double-auth**
```bash
curl -i "$APIM_URL/v1/health" -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"
curl -i "$APIM_URL/v1/scans"   -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"   -H "Authorization: Bearer $BEVOAC_API_KEY"
```

## 21. Sécurité code, données client et écosystème Azure
| Contrôle | État V6.1.1 | Vigilance |
| --- | --- | --- |
| API key hashée | Oui, clé brute affichée une fois. | Rotation et révocation obligatoires. |
| Tenant dérivé serveur | Oui. | Ne jamais accepter tenantId body. |
| Allowlists web/Azure | Oui. | Targets doivent être validées par tenant. |
| SSRF guard | Oui. | Tester localhost, IP privées, metadata. |
| Admin OIDC | Cible production. | Shared secret staging-only. |
| Secrets Key Vault | Oui. | Public access fermé en prod. |
| RLS stricte | Non activée par défaut. | Guardrails DB + décision RLS documentée. |
| Pentest | Non inclus par défaut. | Obligatoire avant revendication enterprise. |
| Backup/restore | Hors chantier selon arbitrage. | Ne pas promettre sans preuve. |

**Tests SSRF recommandés**
```bash
for target in https://127.0.0.1 https://localhost https://10.0.0.1 https://192.168.1.1 https://169.254.169.254; do
  curl -s -o /tmp/ssrf.json -w "$target -> %{http_code}
"     -X POST "$API_BASE_URL/v1/scans"     -H "Authorization: Bearer $BEVOAC_API_KEY"     -H "Content-Type: application/json"     -d "{"cloudProvider":"azure","scanProfile":"web","modules":["web"],"azure":{"targetUrl":"$target"}}"
done
# Attendu: refus 400/403 selon validation/allowlist
```

## 22. Observabilité, alertes et supervision
| Signal | Source | Seuil / action |
| --- | --- | --- |
| API 5xx | Container Apps / Log Analytics | Alerte si hausse prolongée. |
| Service Bus DLQ | Azure Monitor DeadletteredMessages | Seuil > 0, aggregation Maximum. |
| Service Bus backlog | ActiveMessages | Alerte si backlog croissant. |
| PostgreSQL CPU | Azure Monitor | Alerte > 80%. |
| PostgreSQL memory | Azure Monitor | Alerte > 85%. |
| PostgreSQL storage | Azure Monitor | Alerte > 80%. |
| Scans PENDING anciens | SQL opérateur | Investiguer outbox/worker. |
| Outbox FAILED | SQL opérateur | Lire last_error, replay automatique ou investigation. |

**Vérifier Action Group receiver**
```bash
az monitor action-group show   --ids "$MONITOR_ACTION_GROUP_ID"   --query "{name:name,enabled:enabled,emailReceivers:emailReceivers[].{name:name,email:emailAddress,status:status,useCommonAlertSchema:useCommonAlertSchema}}"   -o json
# Attendu: support@dotcloud.fr, status Enabled
```

**Lister les alertes via API compatible**
```bash
export METRIC_ALERT_API_VERSION="2024-03-01-preview"
export AZURE_SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
az rest --method get   --url "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Insights/metricAlerts?api-version=$METRIC_ALERT_API_VERSION"   --query "value[].{name:name,enabled:properties.enabled,severity:properties.severity,frequency:properties.evaluationFrequency,window:properties.windowSize,autoMitigate:properties.autoMitigate}"   -o table
```

**Vérifier critères et Action Group**
```bash
az rest --method get   --url "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Insights/metricAlerts?api-version=$METRIC_ALERT_API_VERSION"   --query "value[].{name:name,enabled:properties.enabled,actionGroups:properties.actions[].actionGroupId,criteria:properties.criteria.allOf[].{metricName:metricName,operator:operator,threshold:threshold,timeAggregation:timeAggregation}}"   -o json
# Point critique attendu: DeadletteredMessages > 0 avec timeAggregation Maximum
```

## 23. Rétention, RGPD et données de scan
V6.1.1 conserve le scheduler de rétention via Container Apps Job. Le job doit être testé dans Azure, pas uniquement en local. Les durées doivent correspondre au contrat client et à la politique de conservation Bevoac.

**Valider le job de rétention**
```bash
export RETENTION_JOB_NAME="$(terraform output -raw retention_job_name)"
az containerapp job show --resource-group "$RESOURCE_GROUP" --name "$RETENTION_JOB_NAME"   --query "{name:name,provisioningState:properties.provisioningState,triggerType:properties.configuration.triggerType,replicaTimeout:properties.configuration.replicaTimeout,replicaRetryLimit:properties.configuration.replicaRetryLimit,image:properties.template.containers[0].image}"   -o json
az containerapp job start --resource-group "$RESOURCE_GROUP" --name "$RETENTION_JOB_NAME"
az containerapp job execution list --resource-group "$RESOURCE_GROUP" --name "$RETENTION_JOB_NAME"   --query "[0:5].{name:name,status:properties.status,startTime:properties.startTime,endTime:properties.endTime}"   -o table
```

**Audit rétention**
```bash
SELECT action, affected_rows, metadata, created_at
FROM retention_audit_log
ORDER BY created_at DESC
LIMIT 10;
```

> **Note**: Backup/restore DB n’est pas livré comme chantier V6.1.1 selon arbitrage produit. Ne pas le promettre comme preuve production enterprise tant qu’un exercice de restauration n’est pas exécuté et documenté.

## 24. Tests client/admin V6.1.1 de bout en bout
Cette section reprend les tests réellement exécutés et validés pour atteindre le GO technique. Elle doit servir de script de recette client/admin.

### 24.1 Charger les variables

```bash
cd bevoac-iac-enterprise
export RESOURCE_GROUP="$(terraform output -raw resource_group_name)"
export API_BASE_URL="$(terraform output -raw api_public_base_url_effective)"
export APIM_URL="$(terraform output -raw apim_gateway_url)"
export APIM_SUBSCRIPTION_REQUIRED="$(terraform output -raw apim_subscription_required)"
export API_CONTAINER_APP="$(terraform output -raw api_container_app_name)"
export WORKER_CONTAINER_APP="$(terraform output -raw worker_container_app_name)"
export OUTBOX_CONTAINER_APP="$(terraform output -raw outbox_publisher_container_app_name)"
export RETENTION_JOB_NAME="$(terraform output -raw retention_job_name)"
export SERVICEBUS_NAMESPACE="$(terraform output -raw service_bus_namespace_short)"
export SERVICEBUS_QUEUE_NAME="$(terraform output -raw service_bus_queue_name)"
export FRONTEND_URL="$(terraform output -raw frontend_url)"
export BEVOAC_API_KEY="<cle-client-bevoac>"
```

### 24.2 Scan web V6.1.1

```bash
export WEB_TARGET_URL="https://portdesigns.com"
HTTP_CODE=$(curl -sS -o /tmp/web611-create.json -w "%{http_code}"   -X POST "$API_BASE_URL/v1/scans"   -H "Authorization: Bearer $BEVOAC_API_KEY"   -H "Content-Type: application/json"   --data-binary @- <<JSON
{
  "cloudProvider": "azure",
  "scanProfile": "web",
  "modules": ["web"],
  "azure": { "targetUrl": "$WEB_TARGET_URL" }
}
JSON
)
echo "HTTP_CODE=$HTTP_CODE"
cat /tmp/web611-create.json | jq .
export SCAN_ID_WEB_611="$(cat /tmp/web611-create.json | jq -r '.scanId // empty')"
```

**Suivi**
```bash
for i in {1..60}; do
  curl -s "$API_BASE_URL/v1/scans/$SCAN_ID_WEB_611?includeResult=false"     -H "Authorization: Bearer $BEVOAC_API_KEY"     | jq '{scanId,status,billingState,resultSummary,errorMessage}'
  sleep 5
done
```

**Validation executionStatus V6.1.1**
```bash
curl -s "$API_BASE_URL/v1/scans/$SCAN_ID_WEB_611"   -H "Authorization: Bearer $BEVOAC_API_KEY"   | jq '{scanId,status,billingState,executionStatus:.result.webSecurity.evidenceMetadata.executionStatus,rawExecutionStatus:.result.webSecurity.executionStatus,rawStatus:.result.webSecurity.status,kpiScorecardTotal:.result.kpiScorecard.totalKpis}'
# Attendu: DONE, CONSUMED, executionStatus SUCCESS, kpiScorecardTotal 1
```

### 24.3 Scan infra sans microsoftTenantId ni subscriptionIds

```bash
RESP_INFRA=$(curl -s -X POST "$API_BASE_URL/v1/scans"   -H "Authorization: Bearer $BEVOAC_API_KEY"   -H "Content-Type: application/json"   --data-binary @- <<'JSON'
{
  "cloudProvider": "azure",
  "scanProfile": "infra",
  "azure": {}
}
JSON
)
echo "$RESP_INFRA" | jq .
export SCAN_ID_INFRA="$(echo "$RESP_INFRA" | jq -r '.scanId // empty')"
```

**Vérifier modules V6**
```bash
curl -s "$API_BASE_URL/v1/scans/$SCAN_ID_INFRA"   -H "Authorization: Bearer $BEVOAC_API_KEY"   | jq '{exposure_map:(.result.azure_infrastructure.modules.exposure_map.status // "missing"),diagnostic_coverage:(.result.azure_infrastructure.modules.diagnostic_coverage.status // "missing"),encryption_coverage:(.result.azure_infrastructure.modules.encryption_coverage.status // "missing"),azure_rbac_exposure:(.result.azure_infrastructure.modules.azure_rbac_exposure.status // "missing"),private_link_coverage:(.result.azure_infrastructure.modules.private_link_coverage.status // "missing"),policy_compliance:(.result.azure_infrastructure.modules.policy_compliance.status // "missing")}'
# Attendu: aucun missing
```

### 24.4 PDF V6.1.1

```bash
curl -s -L "$API_BASE_URL/v1/scans/$SCAN_ID_WEB_611/pdf"   -H "Authorization: Bearer $BEVOAC_API_KEY"   -o bevoac-v6-1-1-web.pdf
file bevoac-v6-1-1-web.pdf
pdftotext bevoac-v6-1-1-web.pdf /tmp/bevoac-v6-1-1-web.txt
grep -nE "KPI Scorecard|WEB_SECURITY_CHECK_PASS_RATE|% contrôles web sans finding FAILED" /tmp/bevoac-v6-1-1-web.txt
# Attendu: PDF document, 1.6 KPI Scorecard, WEB_SECURITY_CHECK_PASS_RATE
```

## 25. Tests de charge multi-tenant
La preuve de charge multi-tenant est obligatoire avant élargissement du pilote ou production contrôlée. L’objectif est de vérifier que Bevoac accepte des créations de scans concurrentes sans 5xx inattendus, sans croissance DLQ et sans violation d’isolation tenant.

**Lancer le test k6**
```bash
API_BASE_URL="$API_BASE_URL" BEVOAC_API_KEY_A="$BEVOAC_API_KEY_A" BEVOAC_API_KEY_B="$BEVOAC_API_KEY_B" BEVOAC_TARGET_URL_A="https://tenant-a.example" BEVOAC_TARGET_URL_B="https://tenant-b.example" TENANT_A_VUS=3 TENANT_B_VUS=3 TEST_DURATION=3m k6 run tests/load/k6-multitenant-b2b-v5-3.js
```

| Critère | Acceptation |
| --- | --- |
| Taux 5xx inattendus | < 5% |
| 429 | Accepté si backpressure atteinte volontairement. |
| DLQ | 0 après rattrapage worker. |
| Scans PENDING anciens | 0 au-delà du seuil opérationnel. |
| Isolation tenant | Lectures croisées 404 / absence dans listings. |

## 26. Troubleshooting structuré des erreurs rencontrées
| Symptôme | Cause probable | Correction |
| --- | --- | --- |
| curl 000 / URL rejected | API_BASE_URL vide ou URL mal formée. | Exporter API_BASE_URL depuis Terraform output. |
| 401 Missing or invalid Authorization header | BEVOAC_API_KEY vide ou absente. | Exporter la clé, vérifier préfixe sans l’afficher. |
| APIM 401 missing subscription key | Ocp-Apim-Subscription-Key absente. | Récupérer/créer subscription APIM. |
| Terraform Key Vault ForbiddenByConnection | Poste hors VNet et Key Vault privé. | Runner privé/VPN ou exception POC temporaire. |
| Terraform duplicate outputs | Fichiers .tf dupliqués. | Supprimer/déplacer doublons avant validate. |
| Service Bus namespace not found avec .servicebus.windows.net | CLI attend le nom court. | Utiliser service_bus_namespace_short. |
| az monitor metrics alert list invalid api-version | Azure CLI utilise une API obsolète. | Utiliser az rest avec 2024-03-01-preview. |
| pdftotext command not found | poppler absent. | brew install poppler. |
| Worker logs Could not find a replica | Worker scale-to-zero normal si queue vide. | Vérifier revision list et queue active. |
| executionStatus UNKNOWN web | Worker ne pose pas status sur webSecurity. | Corrigé en V6.1.1 avec SUCCESS. |
| Backfill SQL 42P08 | Paramètres SQL sans casts explicites. | Corrigé par casts SQL dans script backfill. |
| package.json encore V6.0 | Patch metadata incomplet. | Appliquer hotfix metadata V6.1. |

## 27. Maintenance Azure, ACR et Docker
**ACR et révisions Container Apps**
```bash
az acr repository show-tags --name "$ACR_NAME" --repository bevoac-api-enterprise --orderby time_desc --top 10 -o table
az acr repository show-tags --name "$ACR_NAME" --repository bevoac-worker-enterprise --orderby time_desc --top 10 -o table
az containerapp revision list --resource-group "$RESOURCE_GROUP" --name "$API_CONTAINER_APP" -o table
az containerapp revision list --resource-group "$RESOURCE_GROUP" --name "$WORKER_CONTAINER_APP" -o table
```

- Conserver les tags de release validés et les SHA associés.
- Ne pas supprimer une image encore utilisée par une révision Container Apps.
- Documenter toute rotation de secret ou de clé API.
- Ne pas commiter terraform.tfstate, tfplan, .env ou secrets.
- Aligner Terraform sur worker_image v6.1.2 pour éviter rollback au prochain apply.

## 28. Scénario de démonstration client from scratch
1. Verifier les prérequis poste admin et Azure account.
2. Exécuter Terraform bootstrap ou vérifier l’environnement existant.
3. Build/push images API v6.1.2 et worker v6.1.2 avec tags immutables.
4. Mettre à jour terraform.tfvars et appliquer Terraform.
5. Valider API /v1/health et logs API.
6. Créer ou sélectionner un tenant existant et une API key client-safe.
7. Enregistrer une cible web autorisée.
8. Démarrer onboarding Azure ou utiliser un scope déjà VERIFIED.
9. Lancer un scan web puis un scan Azure infra réel.
10. Démontrer idempotence serveur et replay client.
11. Démontrer isolation tenant avec 404 croisés.
12. Télécharger JSON et PDF.
13. Montrer billing RESERVED -> CONSUMED ou REFUNDED.
14. Montrer DLQ=0, alerting activé avec receiver, retention job Succeeded.
15. Conclure avec la checklist GO/NO-GO et les risques acceptés.

## 29. Fonctionnalités non incluses, risques acceptés et roadmap
| Sujet | Statut V6.1.1 | Message client |
| --- | --- | --- |
| Production enterprise certifiée | Non revendiquée. | Production contrôlée avec risques acceptés. |
| RLS stricte | Option future. | Guardrails DB non cassants présents. |
| Backup/restore DB | Hors chantier selon arbitrage. | Ne pas promettre tant qu’un restore n’est pas prouvé. |
| Pentest externe | À réaliser. | Pré-requis enterprise. |
| AWS/GCP runtime | Roadmap. | Azure-first livré. |
| Sandbox dédié par scan | Non inclus. | Isolation logique + guardrails. |
| SIEM complet | À intégrer selon client. | Logs/alerts Azure disponibles. |
| Shadow IT / CASB | Non inclus. | Ne pas présenter comme module livré. |
| Recertification IAM RH | Non inclus. | Hors périmètre du scan technique Bevoac. |

## 30. Checklist readiness production B2B
| Gate | Statut attendu | GO/NO-GO |
| --- | --- | --- |
| API npm run check/test | OK | GO si OK. |
| Worker npm run check/test | OK | GO si OK. |
| Terraform validate + static-hardening-check | OK | GO si OK. |
| Migrations DB | appliquées ou SKIP | GO si schema_migrations OK. |
| Backfill billing | dry-run final candidates=0 | GO si OK. |
| Tenant isolation check | OK | GO si 0 violation. |
| Outbox publisher dédié | déployé ou exception signée | GO si clair. |
| APIM mode | documenté | GO si intégrateur informé. |
| DLQ | 0 hors tests intentionnels | NO-GO si DLQ persistante. |
| Scan web | DONE/CONSUMED + executionStatus SUCCESS | GO si validé. |
| Scan Azure réel | DONE/CONSUMED ou FAILED/REFUNDED contrôlé | GO si explicable. |
| PDF | KPI Scorecard lisible, sans secret | GO si OK. |
| Rétention job | Succeeded | GO pilote si OK. |
| Alerting | Action Group + receiver email + alertes enabled | GO si OK. |
| Charge multi-tenant | k6 exécuté avant élargissement | NO-GO broad rollout sinon. |
| Pentest | non obligatoire pilote, requis enterprise | NO-GO enterprise sinon. |

## 31. Annexe SQL opérateur utile
```bash
-- Derniers scans
SELECT id, tenant_id, status, billing_state, scan_profile, created_at, updated_at, completed_at
FROM scans
ORDER BY created_at DESC
LIMIT 20;

-- Outbox par statut
SELECT status, COUNT(*) FROM outbox_events GROUP BY status ORDER BY status;

-- Outbox bloquée
SELECT id, aggregate_id, tenant_id, status, attempts, last_error, created_at, updated_at
FROM outbox_events
WHERE status IN ('PENDING','FAILED','PROCESSING')
  AND created_at < NOW() - INTERVAL '10 minutes'
ORDER BY created_at ASC;

-- Ledger billing d’un scan
SELECT scan_id, event_type, billing_units, amount_eur_ht, metadata, recorded_at
FROM billing_usage_ledger
WHERE scan_id = '<SCAN_ID>'
ORDER BY recorded_at ASC;

-- Résultat stocké
SELECT scan_id, tenant_id, compression, result_size_bytes, result_sha256, result_summary
FROM scan_results
WHERE scan_id = '<SCAN_ID>';

-- Tentatives worker
SELECT attempt_id, scan_id, tenant_id, status, error_message, started_at, completed_at
FROM scan_attempts
WHERE scan_id = '<SCAN_ID>'
ORDER BY started_at DESC;

-- Guardrails tenant
SELECT * FROM tenant_isolation_violations LIMIT 50;
```

## 32. Matrice d’alignement code / documentation
| Sujet | Code / IaC attendu | Documentation V6.1.1 |
| --- | --- | --- |
| API image | bevoac-api-enterprise:v6.1.2 | Titre, build et validations. |
| Worker version | Image bevoac-worker-enterprise:v6.1.2 | Build/push, executionStatus SUCCESS. |
| Contrat scan | 2026-06-01-kpi-modules-v6 | Chapitres versions, worker. |
| Idempotence serveur | idempotencyKeySource server_generated | Chapitres scan et tests. |
| Transactional outbox | outbox_events + enqueueScanRequested | Architecture, SQL, outbox. |
| Publisher dédié | ca-*-outbox + outbox-publisher-daemon | Chapitre 19. |
| Billing lifecycle | RESERVED / CONSUMED / REFUNDED | Chapitre 15. |
| Backfill billing | scripts/backfill-final-billing-state.js | Chapitre 8.1. |
| PDF KPI | 1.6 KPI Scorecard | Chapitre 16 et tests PDF. |
| Tenant guardrails | check:tenant-isolation | Chapitres 11 et 14. |
| APIM | service_url /v1, operations proxy, subscription variable | Chapitre 20. |
| Alerting | monitor-alerts.tf + Action Group receiver | Chapitre 22. |
| Retention | Container Apps Job | Chapitre 23. |
| Charge | k6 V5.3 scénario toujours valide | Chapitre 25. |

## 33. Inventaire documentaire et politique d’archives
Documents actifs V6.1.1 à publier :

- docs/Runbook_Bevoac_V6_1_1_Production_Ready_Client_B2B.md
- docs/Runbook_Bevoac_V6_1_1_Production_Ready_Client_B2B.docx
- docs/operations/document-inventory-v6-1-1.md
- docs/operations/validation-go-v6-1-1.md
- docs/operations/azure-monitor-v6-1-1.md
- docs/operations/backfill-billing-v6-1-1.md
- docs/mermaid/*.mmd
- docs/diagrams/*.png

Documents historiques à conserver mais à ne pas présenter comme actifs :

- runbooks V4.2, V5.1, V5.2, V5.3 ;
- comparatifs historiques ;
- sources/reference docs ;
- anciens packages de recette.

> **Note**: Ne pas supprimer sans PR dédiée. Recommandation : déplacer vers docs/archive/legacy-v4-v5-3/ après validation.

## 34. Annexes Mermaid et sources
Les sources Mermaid maintenables sont livrées dans docs/mermaid. Les PNG rendus sont livrés dans docs/diagrams et intégrés dans ce runbook. Chaque schéma doit être régénéré en cas de changement d’architecture, de flux, d’APIM ou d’outbox.

**Schéma 1 - Mermaid architecture_v6_1_1.mmd**
```bash
flowchart LR
  C[Client B2B / Integrateur] --> APIM[APIM optionnel<br/>Double-auth possible]
  APIM --> API[API Fastify /v1<br/>Auth API key -> tenant Bevoac]
  API --> AUTH[Validation tenant<br/>Reject tenantId/customerId]
  AUTH --> ALLOW[Scopes autorises<br/>tenant_web_targets / tenant_azure_scopes]
  ALLOW --> IDEM[Idempotency<br/>server_generated ou client_supplied]
  IDEM --> BILL[Billing reservation<br/>scan_reserved + RESERVED]
  BILL --> DB[(PostgreSQL<br/>scans + scan_results<br/>ledger + outbox_events)]
  DB --> OP[Outbox publisher dedie<br/>Container App outbox]
  OP --> SB[Service Bus scan-jobs<br/>Sessions tenant + DLQ]
  SB --> W[Worker Container Apps<br/>retry/backoff + idempotence]
  W --> MOD[Modules web / Azure / Entra<br/>KPI engine + evidence metadata]
  MOD --> RES[(scan_results<br/>JSON complet + hash + summary)]
  RES --> API
  API --> JSON[JSON API<br/>summary + result + KPI scorecard]
  API --> PDF[PDF report<br/>findings + remediation + evidence<br/>KPI Scorecard]
```

**Schéma 2 - Mermaid onboarding_azure_v6_1_1.mmd**
```bash
flowchart TB
  A[Client start onboarding<br/>POST /v1/onboarding/azure/start] --> B[API cree session courte<br/>state HMAC + nonce]
  B --> C[Microsoft Entra admin consent]
  C --> D[API callback<br/>verify state, expiration, anti-replay]
  D --> E[Verifier RBAC subscriptions]
  E --> F[Upsert tenant_azure_scopes<br/>VERIFIED / NEEDS_RBAC]
  F --> G[Redirect frontend<br/>success / action_required / error]
```

**Schéma 3 - Mermaid scan_lifecycle_v6_1_1.mmd**
```bash
flowchart TB
  A[POST /v1/scans<br/>Idempotency-Key optionnelle] --> B[API derive tenant<br/>payload + allowlists]
  B --> C[Transaction DB<br/>PENDING + RESERVED + idempotency + scan_reserved + outbox]
  C --> D[Outbox publisher dedie]
  D --> E[Service Bus sessionId=tenant_id]
  E --> F[Worker beginAttempt<br/>PENDING -> IN_PROGRESS]
  F --> G[Modules web / Entra / Azure<br/>timeouts + retry/backoff + KPI]
  G --> H[scan_results + summary + hash + kpiScorecard]
  H --> I[DONE -> scan_consumed<br/>FAILED -> scan_refunded]
```

**Schéma complémentaire - foundation_v6_1_1.mmd**
```bash
flowchart LR
  TF[Terraform] --> AZ[Azure Control Plane]
  AZ --> ACR[ACR]
  AZ --> KV[Key Vault]
  AZ --> PG[PostgreSQL]
  AZ --> SB[Service Bus]
  AZ --> ACA[Container Apps]
  AZ --> APIM[APIM]
  AZ --> MON[Monitor + Action Group]
```

## 35. Conclusion
Bevoac V6.1.1 dispose d’un socle technique crédible pour un contexte B2B : idempotence serveur, transactional outbox, outbox publisher dédié, worker asynchrone, modules Azure enrichis, KPI engine, PDF evidence-first avec KPI Scorecard, billing state cohérent, backfill historique, retention, APIM double-auth, Azure Monitor avec receiver email, et tests client/admin de bout en bout.

Le bon discours client est ambitieux mais maîtrisé : Bevoac est prêt pour une démonstration professionnelle, un pilote B2B avancé et une production contrôlée avec risques acceptés. Les claims enterprise complets nécessitent des preuves supplémentaires : pentest, charge à plus grande échelle, runbook incident, décision RLS ou équivalent, et sécurité contractuelle selon le contexte client.

> **Note**: Phrase finale client-safe : Bevoac V6.1.1 industrialise les audits web et Azure via une API B2B traçable, idempotente, multi-tenant logique et exploitable, avec JSON exhaustif, PDF orienté remédiation, KPI Scorecard et garde-fous d’exploitation adaptés à un pilote ou une production contrôlée.

---

36. Sprint Documentation + CI release lock
==========================================

Ce sprint verrouille la version V6.1.1 apres les validations client/admin.

Objectifs obligatoires:

- documentation active alignee V6.1.1;
- README racine remplace V5.3 par V6.1.1;
- anciens runbooks V4/V5 archives sous `docs/archive/legacy-v4-v5-3/`;
- workflow CI worker execute `npm test`;
- release evidence V6.1.1 publiee;
- APIM obligatoire et policy renforcee;
- RLS PostgreSQL verifiable;
- backup/restore PostgreSQL testable sur Azure;
- retention client standard/business/payg explicite.

Validation CI attendue:

```bash
cd bevoac-api-enterprise
npm install
npm run check
npm test
npm run backfill:billing:dry-run
npm run check:rls

cd ../bevoac-worker-enterprise
npm install
npm run check
npm test

cd ../bevoac-iac-enterprise
terraform fmt -recursive
terraform init -backend=false
terraform validate
bash scripts/static-hardening-check.sh
bash scripts/check-retention-policy.sh
```

37. APIM obligatoire et policy renforcee
========================================

En V6.1.1, le chemin client nominal passe par APIM. L'API directe reste uniquement un chemin operateur/break-glass tant que la restriction reseau stricte APIM-only n'est pas finalisee. APIM doit etre deploye avec `subscription_required=true`.

Controls APIM requis:

- subscription key obligatoire;
- API key Bevoac toujours obligatoire;
- `X-Correlation-Id` injecte si absent;
- `X-Bevoac-Gateway=apim` injecte;
- rate limit gateway;
- quota gateway;
- refus 413 si `Content-Length` depasse la limite policy.

Verification:

```bash
cd bevoac-iac-enterprise
grep -n "subscription_required *= *true" api-gateway-apim.tf
grep -n "rate-limit\|quota\|validate-content\|X-Correlation-Id\|X-Bevoac-Gateway" api-gateway-apim.tf
bash scripts/static-hardening-check.sh
```

Tests APIM obligatoires:

```bash
curl -s -o /tmp/apim-no-sub-key.json -w "%{http_code}\n" "$APIM_URL/v1/scans"
curl -s -o /tmp/apim-no-bevoac-key.json -w "%{http_code}\n" "$APIM_URL/v1/scans" -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"
curl -s -o /tmp/apim-valid-scans.json -w "%{http_code}\n" "$APIM_URL/v1/scans" -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" -H "Authorization: Bearer $BEVOAC_API_KEY"
```

Attendus: `401`, `401`, `200`.

38. PostgreSQL RLS confirme
===========================

V6.1.1 livre une migration RLS optionnelle et controlee. Elle active RLS sur les tables tenant-scoped et installe des policies tenant-aware. Elle prevoit un contexte service explicite pour API/worker/outbox/retention/admin afin de ne pas casser les traitements backend.

Application controlee:

```bash
cd bevoac-api-enterprise
ALLOW_RLS_APPLY=true npm run migrate-db:rls
npm run check:rls
```

Attendu:

```text
[OK] scans: RLS enabled with ... policy/policies
[OK] scan_results: RLS enabled with ... policy/policies
[OK] scan_attempts: RLS enabled with ... policy/policies
[OK] billing_usage_ledger: RLS enabled with ... policy/policies
[OK] outbox_events: RLS enabled with ... policy/policies
RLS tenant policy checks passed.
```

Important: cette implementation confirme la presence de RLS et la politique tenant-aware. Pour un environnement enterprise strict, completer par un role runtime non-owner et des tests de denial effectifs par role applicatif.

39. PostgreSQL backup/restore Azure
===================================

PostgreSQL Flexible Server conserve les backups Azure selon la configuration du serveur. Le runbook V6.1.1 exige un restore drill periodique pour prouver la recuperation apres incident.

Verifier la retention backup:

```bash
cd bevoac-iac-enterprise
bash scripts/postgres-backup-status.sh
```

Restaurer un serveur test:

```bash
export RESTORE_SERVER_NAME="psql-bevoac-restore-$(date +%Y%m%d%H%M)"
export RESTORE_TIME_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
bash scripts/postgres-restore-drill.sh
```

Validation post-restore:

```sql
SELECT version, name, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 10;
SELECT COUNT(*) FROM tenants;
SELECT COUNT(*) FROM scans;
SELECT COUNT(*) FROM scan_results;
```

Nettoyer apres drill:

```bash
az postgres flexible-server delete --resource-group "$RESOURCE_GROUP" --name "$RESTORE_SERVER_NAME" --yes
```

40. Retention par plan et conservation PDF client
=================================================

Le PDF Bevoac est genere a la demande depuis le JSON de resultat. La conservation effective du PDF depend donc de la conservation du scan et de `scan_results`.

Politique V6.1.1:

| Plan | Conservation scans/resultats/PDF generable |
|---|---:|
| free | 30 jours |
| standard | 90 jours |
| business | 180 jours |
| payg | 180 jours |

Validation locale:

```bash
cd bevoac-api-enterprise
npm test -- tests/retention/retention-policy.test.js
```

Validation IaC:

```bash
cd bevoac-iac-enterprise
bash scripts/check-retention-policy.sh
```

Dry-run retention:

```bash
az containerapp job start --resource-group "$RESOURCE_GROUP" --name "$RETENTION_JOB_NAME"
az containerapp job execution list --resource-group "$RESOURCE_GROUP" --name "$RETENTION_JOB_NAME" -o table
```

41. Release evidence V6.1.1
===========================

Publier `docs/operations/release-evidence-v6-1-1.md` avec les preuves suivantes:

- API `npm run check` et `npm test`;
- worker `npm run check` et `npm test`;
- Terraform validate et static hardening;
- APIM 401/401/200;
- scan web `DONE/CONSUMED` avec `executionStatus=SUCCESS`;
- scan infra `DONE/CONSUMED` sans `microsoftTenantId` ni `subscriptionIds` client;
- PDF avec `1.6 KPI Scorecard`;
- Service Bus `active=0`, `deadLetter=0`;
- retention job `Succeeded`;
- Azure Monitor receiver email et alertes activees;
- backfill billing final `candidates=0`;
- RLS `check:rls` OK;
- backup status et restore drill date.

42. Checklist GO finale V6.1.1 Production Ready
===============================================

| Domaine | Gate | Attendu |
|---|---|---|
| Documentation | README V6.1.1 + runbook actif | OK |
| CI | API tests + worker tests | OK |
| APIM | Mandatory + rate/size/quota/correlation | OK |
| RLS | `npm run check:rls` | OK |
| Backup/restore | restore drill documente | OK |
| Retention | standard 90, business/payg 180 | OK |
| API | health/auth/scans/PDF | OK |
| Worker | scan web executionStatus SUCCESS | OK |
| Outbox/DLQ | published, DLQ=0 | OK |
| Billing | RESERVED -> CONSUMED/REFUNDED | OK |
| Evidence | release evidence V6.1.1 complete | OK |


43. Conclusion finale apres release lock
=======================================

Avec ce sprint, Bevoac V6.1.1 dispose d un runbook actif, d un README aligne, d une archive historique V4/V5, d une CI worker verrouillee, d une gateway APIM obligatoire et renforcee, d un chemin RLS confirme, d une procedure backup/restore Azure et d une retention client par plan.

Le statut recommande est GO pour demonstration client, GO pour pilote B2B avance, GO pour production controlee avec risques acceptes, et GO conditionnel pour production enterprise stricte apres pentest, charge elargie, restore drill periodique et decision RLS/role runtime non-owner.

Phrase client-safe finale: Bevoac V6.1.1 industrialise les audits web et Azure via une API B2B tracable, idempotente, multi-tenant logique et exploitable, avec APIM obligatoire, JSON exhaustif, PDF evidence-first, KPI Scorecard, retention par plan, alerting et procedures d exploitation adaptees a une production controlee.
