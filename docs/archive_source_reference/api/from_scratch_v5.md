# Bevoac V5.1 - Installation from scratch

## Objectif

Ce document complète le runbook. Il décrit deux scénarios :

1. from scratch code : clone propre, application des correctifs, contrôles et commit ;
2. from scratch infra Azure : recréation de l'infra, images, base, tenant, onboarding, scans et PDF.

## 1. From scratch code

```bash
git clone -b dev https://github.com/flegallic/bevoac.git bevoac-v5-clean
cd bevoac-v5-clean
git checkout -b v5.1-production-docs
```

Appliquer les correctifs runtime déjà validés si nécessaire, puis cette mise à jour docs :

```bash
bash ./apply_docs_update.sh .
```

Contrôler :

```bash
git status
git diff --stat
```

API :

```bash
cd bevoac-api-enterprise
npm install
npm run check
```

Worker :

```bash
cd ../bevoac-worker-enterprise
npm install
npm run check
```

Terraform :

```bash
cd ../bevoac-iac-enterprise
terraform fmt -recursive
terraform validate
```

Commit :

```bash
git add .
git commit -m "docs: update Bevoac V5.1 production documentation"
```

## 2. From scratch infra Azure

### 2.1 Terraform bootstrap

```bash
cd bevoac-iac-enterprise
cp terraform.tfvars.example terraform.tfvars
```

Renseigner les variables obligatoires : tenant, préfixe, App Registration scanner, OIDC admin, private endpoints, images.

Premier apply sans Container Apps si ACR vide :

```bash
terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=tfplan.bootstrap
terraform apply tfplan.bootstrap
rm -f tfplan.bootstrap
```

### 2.2 Build/push images

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

### 2.3 Déploiement apps

Dans `terraform.tfvars` :

```hcl
deploy_container_apps = true
api_image    = "<acr>.azurecr.io/bevoac-api-enterprise:v5.1.0"
worker_image = "<acr>.azurecr.io/bevoac-worker-enterprise:v5.1.0"
```

```bash
cd ../bevoac-iac-enterprise
terraform plan -out=tfplan.apps
terraform apply tfplan.apps
rm -f tfplan.apps
```

### 2.4 Base de données

Depuis un réseau autorisé :

```bash
cd ../bevoac-api-enterprise
node scripts/init-db.js
node scripts/init-db.production-hardening.js
```

### 2.5 Onboarding et tests

Créer un tenant :

```bash
node scripts/create-tenant.js "Client Demo SAS" standard
```

Enregistrer un domaine web :

```bash
node scripts/register-web-target.js <tenantId> https://portdesigns.com
```

Lancer onboarding Azure puis vérifier :

```bash
curl -s "$API_BASE_URL/v1/onboarding/azure/status" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" | jq .
```

Scan web :

```bash
curl -s -X POST "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"cloudProvider":"azure","scanProfile":"web","azure":{"targetUrl":"https://portdesigns.com"}}' | jq .
```

Scan infra :

```bash
curl -s -X POST "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"cloudProvider":"azure","scanProfile":"infra","azure":{}}' | jq .
```

PDF :

```bash
curl -L "$API_BASE_URL/v1/scans/<scanId>/pdf" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -o report.pdf
```

## 3. Sortie attendue

- `GET /v1/health` retourne 200.
- Un scan web passe `DONE`.
- Un scan infra passe `DONE`.
- Le PDF est généré.
- Service Bus : `active=0`, `deadLetter=0`.
- Aucun scan orphelin `PENDING`.
- PostgreSQL et Key Vault refermés selon posture production.
