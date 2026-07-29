# Bevoac Runbook Production V5.1 - Azure-first B2B

## 1. Objectif

Ce runbook décrit l'exploitation du socle Bevoac Azure-first durci V5.1.

Bevoac est une API SaaS de scan d'audit sécurité permettant à un client, un intégrateur ou un partenaire de lancer des audits web, Entra et Azure infrastructure, de récupérer des résultats JSON structurés, de générer des rapports PDF finding/remediation/evidence, de suivre l'historique, le billing et de relancer des scans après remédiation.

AWS et GCP ne sont pas couverts par cette version runtime. Ils restent en roadmap. Le périmètre production documenté ici est Azure-first.

## 2. Statut produit

La V5.1 doit être comprise comme un socle production-oriented, pas comme une simple démonstration.

Elle inclut :

- tenant Bevoac dérivé de l'API key ;
- rejet de `tenantId` et `customerId` fournis par le client ;
- allowlist web et Azure ;
- quota mensuel verrouillé par tenant/mois ;
- backpressure par tenant et par plan ;
- Service Bus `scan-jobs` avec sessions par tenant ;
- worker asynchrone idempotent ;
- contrat de message API/worker versionné ;
- stockage des résultats complets dans `scan_results` ;
- résumé indexable `result_summary` ;
- garde SSRF/DNS pour scans web ;
- timeouts par module ;
- génération PDF bornée ;
- DLQ observable et purgeable ;
- auth admin OIDC Entra ;
- Key Vault, Managed Identity et private endpoints supportés par Terraform ;
- scripts de rétention/RGPD.

## 3. Pré-requis production

- Node.js 20 LTS recommandé.
- Terraform 1.6+.
- Azure CLI récent.
- AzureRM provider compatible avec le repo.
- Backend Terraform distant chiffré.
- Abonnement Azure ou resource group dédié.
- ACR, Container Apps, Service Bus, PostgreSQL Flexible Server, Key Vault.
- App Registration Microsoft multi-tenant pour onboarding Azure client.
- App Registration / Enterprise App admin Bevoac pour l'admin API OIDC.
- Groupe Entra ou Managed Identity stable pour exécuter Terraform.
- Runner privé, VM d'administration dans le VNet ou poste connecté via VPN pour les environnements avec private endpoints fermés.

## 4. Règle d'exploitation : POC vs production stricte

### POC / recette

Les opérations suivantes peuvent être tolérées temporairement :

- ouvrir Key Vault public network access pour débloquer un `terraform plan/apply` depuis un poste local ;
- ouvrir PostgreSQL à l'IP publique d'un administrateur pour une migration ponctuelle ;
- purger une DLQ manuellement ;
- exécuter un script d'administration depuis le poste d'un opérateur.

Ces ouvertures doivent être refermées après intervention.

### Production stricte

En production :

- Key Vault public access doit être désactivé ;
- PostgreSQL public access doit être désactivé ;
- Terraform ne doit pas être lancé depuis un poste Internet public ;
- l'accès aux secrets et à PostgreSQL doit passer par Private Link/VNet/VPN/runner privé ;
- l'admin API doit utiliser OIDC, pas un secret partagé ;
- les API keys exposées ou copiées dans un canal non sûr doivent être révoquées.

## 5. From scratch code

Objectif : repartir d'un clone propre, appliquer les correctifs V5.1, contrôler et commiter.

```bash
git clone -b dev https://github.com/flegallic/bevoac.git bevoac-v5-clean
cd bevoac-v5-clean
git checkout -b v5.1-docs-and-runtime-alignment
```

Appliquer les packages de correction runtime déjà livrés si nécessaire, puis appliquer ce package documentation :

```bash
bash ./apply_docs_update.sh .
```

Contrôles :

```bash
git status
git diff --stat
find docs -type f | sort
```

Contrôle API :

```bash
cd bevoac-api-enterprise
npm install
npm run check
```

Contrôle worker :

```bash
cd ../bevoac-worker-enterprise
npm install
npm run check
```

Contrôle Terraform :

```bash
cd ../bevoac-iac-enterprise
terraform fmt -recursive
terraform validate
```

Commit :

```bash
git add .
git commit -m "docs: align V5.1 production runbook and deployment guide"
```

## 6. From scratch infra Azure

### 6.1 Bootstrap plateforme

```bash
cd bevoac-iac-enterprise
cp terraform.tfvars.example terraform.tfvars
```

Variables minimales :

```hcl
tenant_id   = "<tenant Azure de deploiement>"
prefix      = "bevoac-prod"
environment = "prod"

deploy_container_apps      = false
deploy_onboarding_frontend = true

microsoft_client_id     = "<app registration Bevoac scanner client id>"
microsoft_client_secret = "<secret stocke/roté via Key Vault>"
api_public_base_url     = "https://api.example.com"

admin_auth_mode           = "oidc"
admin_oidc_issuer         = "<issuer exact du token admin>"
admin_oidc_audience       = "api://<admin-api-client-id>"
admin_oidc_required_roles = "Bevoac.Admin"

enable_service_bus_sessions   = true
enable_private_endpoints      = true
enable_postgres_public_access = false
```

Appliquer la plateforme sans Container Apps si ACR vide :

```bash
terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=tfplan.bootstrap
terraform apply tfplan.bootstrap
rm -f tfplan.bootstrap
```

### 6.2 Build/push images

```bash
ACR_LOGIN_SERVER="$(terraform output -raw acr_login_server)"
az acr login --name "$(echo "$ACR_LOGIN_SERVER" | cut -d. -f1)"
```

API :

```bash
cd ../bevoac-api-enterprise
docker build --platform linux/amd64 -t "$ACR_LOGIN_SERVER/bevoac-api-enterprise:v5.1.0" .
docker push "$ACR_LOGIN_SERVER/bevoac-api-enterprise:v5.1.0"
```

Worker :

```bash
cd ../bevoac-worker-enterprise
docker build --platform linux/amd64 -t "$ACR_LOGIN_SERVER/bevoac-worker-enterprise:v5.1.0" .
docker push "$ACR_LOGIN_SERVER/bevoac-worker-enterprise:v5.1.0"
```

### 6.3 Déploiement Container Apps

Dans `terraform.tfvars` :

```hcl
deploy_container_apps = true
api_image    = "<acr>.azurecr.io/bevoac-api-enterprise:v5.1.0"
worker_image = "<acr>.azurecr.io/bevoac-worker-enterprise:v5.1.0"
```

Puis :

```bash
cd ../bevoac-iac-enterprise
terraform plan -out=tfplan.apps
terraform apply tfplan.apps
rm -f tfplan.apps
```

### 6.4 Initialisation PostgreSQL

En production stricte, exécuter ces scripts depuis un environnement ayant accès au VNet/PostgreSQL Private Link.

```bash
cd ../bevoac-api-enterprise
node scripts/init-db.js
node scripts/init-db.production-hardening.js
```

Ces scripts créent ou mettent à jour notamment `scan_results`, `scan_attempts`, les colonnes de suivi, les indexes multi-tenant et la migration legacy depuis `scans.result`.

## 7. Admin API OIDC

Production doit utiliser :

```env
ADMIN_AUTH_MODE=oidc
ADMIN_OIDC_ISSUER=<issuer exact du token>
ADMIN_OIDC_AUDIENCE=<aud exact du token>
ADMIN_OIDC_REQUIRED_ROLES=Bevoac.Admin
```

Point d'attention : Azure CLI peut émettre un token avec issuer v1 :

```text
https://sts.windows.net/<tenant-id>/
```

alors qu'une application web OIDC moderne peut produire :

```text
https://login.microsoftonline.com/<tenant-id>/v2.0
```

La valeur `ADMIN_OIDC_ISSUER` doit être exactement alignée sur le champ `iss` du token réellement présenté à l'API. La valeur `ADMIN_OIDC_AUDIENCE` doit être exactement alignée sur le champ `aud`.

Décodage local d'un token :

```bash
export ADMIN_TOKEN="<jwt>"
python3 - <<'PY'
import os, json, base64
token = os.environ["ADMIN_TOKEN"]
payload = token.split(".")[1]
payload += "=" * (-len(payload) % 4)
data = json.loads(base64.urlsafe_b64decode(payload.encode()))
print(json.dumps({key: data.get(key) for key in ["aud","iss","roles","scp","tid","upn","preferred_username"]}, indent=2))
PY
```

## 8. Création tenant et scopes

Créer un tenant :

```bash
cd bevoac-api-enterprise
node scripts/create-tenant.js "Client Demo SAS" standard
```

Enregistrer un target web :

```bash
node scripts/register-web-target.js <bevoacTenantId> https://portdesigns.com
```

Onboarding Azure :

```bash
curl -s -X POST "$API_BASE_URL/v1/onboarding/azure/start" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

Le callback Microsoft doit être :

```text
https://<api-fqdn>/v1/onboarding/azure/callback
```

## 9. Création de scan et idempotence

### 9.1 Règle produit

`Idempotency-Key` est optionnelle.

Si le client la fournit, Bevoac la réutilise pour éviter les doublons en cas de retry réseau.

Si le client ne la fournit pas, l'API génère automatiquement une clé serveur et la retourne dans la réponse.

Recommandation B2B :

- portail ou usage simple : laisser Bevoac générer la clé ;
- intégration critique : fournir une clé métier stable par tentative de scan.

### 9.2 Scan web simple

```bash
curl -s -X POST "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "cloudProvider": "azure",
    "scanProfile": "web",
    "azure": {
      "targetUrl": "https://portdesigns.com"
    }
  }' | jq .
```

Réponse attendue :

```json
{
  "scanId": "uuid",
  "status": "PENDING",
  "idempotencyKey": "uuid",
  "idempotencyKeySource": "server_generated",
  "idempotentReplay": false
}
```

### 9.3 Scan infra Azure

Si l'onboarding Azure est complet, le scan infra peut s'appuyer sur les scopes vérifiés du tenant :

```bash
curl -s -X POST "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "cloudProvider": "azure",
    "scanProfile": "infra",
    "azure": {}
  }' | jq .
```

Avec ciblage explicite :

```json
{
  "cloudProvider": "azure",
  "scanProfile": "infra",
  "azure": {
    "microsoftTenantId": "<microsoft-tenant-id>",
    "subscriptions": ["<subscription-id>"]
  }
}
```

### 9.4 Scan full

```json
{
  "cloudProvider": "azure",
  "scanProfile": "full",
  "azure": {
    "targetUrl": "https://portdesigns.com"
  }
}
```

Le profil `full` exécute le web et les modules Azure/Entra disponibles selon les scopes.

## 10. Lecture résultat et PDF

```bash
curl -s "$API_BASE_URL/v1/scans/<scanId>" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" | jq .
```

Liste ou portail sans gros JSON :

```bash
curl -s "$API_BASE_URL/v1/scans/<scanId>?includeResult=false" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" | jq .
```

PDF :

```bash
curl -L "$API_BASE_URL/v1/scans/<scanId>/pdf" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -o bevoac-report.pdf
```

Le PDF est un rapport finding/remediation/evidence. L'exhaustivité brute reste dans le JSON API.

## 11. Contrat API/worker

La version de contrat de message doit être partagée, pas recopiée en dur.

Source recommandée :

```text
contracts/scan-message-version.json
```

Valeur V5.1 :

```text
2026-05-06-production-hardening-v5
```

L'API et le worker doivent utiliser cette source. Le schéma worker `contracts/scan-request.schema.json` doit accepter exactement cette version.

Une désynchronisation provoque une DLQ avec erreur :

```text
/path /version must be equal to constant
```

## 12. Service Bus, sessions et DLQ

État de la queue :

```bash
az servicebus queue show \
  --resource-group <rg> \
  --namespace-name <sb-namespace-short> \
  --name scan-jobs \
  --query "{requiresSession:requiresSession,active:countDetails.activeMessageCount,deadLetter:countDetails.deadLetterMessageCount}" \
  -o json
```

Attendu nominal :

```json
{
  "requiresSession": true,
  "active": 0,
  "deadLetter": 0
}
```

### 12.1 Stats DLQ

```bash
cd bevoac-worker-enterprise
node scripts/dlq-stats.js
```

### 12.2 Replay contrôlé

Dry-run :

```bash
DRY_RUN=true MAX_REPLAY=10 node scripts/dlq-replay.js
```

Replay réel :

```bash
DRY_RUN=false MAX_REPLAY=10 node scripts/dlq-replay.js
```

### 12.3 Purge DLQ d'un message obsolète

Cas typique : ancien message DLQ issu d'un mauvais contrat `/version`.

Dry-run :

```bash
node scripts/purge-dlq.js \
  --fq-namespace=sb-bevoac-prod.servicebus.windows.net \
  --queue=scan-jobs \
  --sessions=true \
  --credential=cli \
  --max-wait-ms=30000
```

Purge :

```bash
node scripts/purge-dlq.js \
  --fq-namespace=sb-bevoac-prod.servicebus.windows.net \
  --queue=scan-jobs \
  --sessions=true \
  --credential=cli \
  --max-wait-ms=30000 \
  --yes
```

Si un message DLQ session-enabled reste comptabilisé mais n'est pas récupérable via SDK, utiliser l'une des options suivantes :

1. Azure Portal > Service Bus Explorer > queue `scan-jobs` > Dead-letter > Delete/Complete.
2. En POC uniquement, recréer la queue si `active=0`, `scheduled=0`, `transferDeadLetter=0`.

Remplacement Terraform contrôlé en POC :

```bash
terraform state list | grep servicebus_queue
terraform plan -replace='azurerm_servicebus_queue.scan_jobs' -out=tfplan.replace-queue
terraform apply tfplan.replace-queue
rm -f tfplan.replace-queue
```

## 13. Scans bloqués PENDING

Un scan bloqué `PENDING` peut résulter d'un ancien échec d'enqueue ou d'un message DLQ.

Lister les actifs :

```bash
curl -s "$API_BASE_URL/v1/scans?limit=20" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
| jq '.[] | select(.status=="PENDING" or .status=="IN_PROGRESS")'
```

Ne pas supprimer les lignes directement. En POC, marquer en `FAILED` avec un motif explicite pour libérer le backpressure. En production, ouvrir un incident d'exploitation et vérifier DLQ/worker avant action.

## 14. Rétention/RGPD

Dry-run :

```bash
cd bevoac-api-enterprise
DRY_RUN=true node scripts/retention-sweep.js
```

Suppression réelle :

```bash
DRY_RUN=false SCAN_RESULT_RETENTION_DAYS=180 FAILED_SCAN_RETENTION_DAYS=90 node scripts/retention-sweep.js
```

Les suppressions doivent être journalisées dans `retention_audit_log`.

## 15. Validation avant vente / production

- `npm run check` API + worker.
- `terraform fmt -recursive && terraform validate`.
- OIDC admin validé avec token réel.
- Key Vault et PostgreSQL fermés au public en mode production.
- Terraform exécuté depuis runner privé/VPN/VM admin.
- API key exposée révoquée et nouvelle clé créée.
- Onboarding Microsoft complet.
- Scan web réel autorisé.
- Scan infra Azure réel.
- Rapport PDF généré.
- Queue Service Bus : `active=0`, `deadLetter=0` après traitement.
- Tests de charge API/worker/PostgreSQL/PDF.
- Pentest API, SSRF et auth.
- Test backup/restore PostgreSQL.
- Test rotation secrets Key Vault.
- Test rétention/RGPD.
