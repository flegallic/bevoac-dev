# Guide de déploiement Bevoac V5.1 Production

## 1. Objet

Ce guide décrit le déploiement Bevoac Azure-first V5.1 avec API, worker, Service Bus sessions, PostgreSQL, Key Vault, OIDC admin, private endpoints et documentation alignée.

## 2. Variables Terraform minimales

```hcl
tenant_id   = "<tenant de deploiement>"
prefix      = "bevoac-prod"
environment = "prod"

microsoft_client_id     = "<app registration scanner Bevoac>"
microsoft_client_secret = "<secret scanner gere via Key Vault>"
api_public_base_url     = "https://api.example.com"

admin_auth_mode           = "oidc"
admin_oidc_issuer         = "<issuer exact du token admin>"
admin_oidc_audience       = "api://<admin-api-client-id>"
admin_oidc_required_roles = "Bevoac.Admin"

enable_private_endpoints      = true
enable_postgres_public_access = false
enable_service_bus_sessions   = true
log_analytics_retention_days  = 90
deploy_container_apps         = false
```

`admin_api_secret` ne doit pas être utilisé comme mécanisme admin en production. Il peut rester présent comme fallback local/staging uniquement si le code le requiert, mais `ADMIN_AUTH_MODE=oidc` doit être le mode actif.

## 3. Terraform state et identité d'exécution

Utiliser un backend distant chiffré.

Ne jamais commiter `.terraform/`, `terraform.tfstate`, `tfplan`, `.env`, secrets ou certificats.

Production stricte :

- Terraform doit être exécuté depuis un runner privé, une VM d'administration dans le VNet ou un poste connecté via VPN.
- L'identité Terraform doit être stable : Managed Identity CI/CD, service principal CI/CD, ou groupe Entra `bevoac-platform-admins`.
- Éviter `data.azurerm_client_config.current.object_id` comme source d'un rôle permanent si plusieurs utilisateurs lancent Terraform.

## 4. Ordre de rollout sûr

1. `terraform init`
2. `terraform fmt -recursive`
3. `terraform validate`
4. `terraform apply` avec `deploy_container_apps=false` si ACR vide
5. build/push API et worker
6. `node scripts/init-db.js`
7. `node scripts/init-db.production-hardening.js`
8. activer `deploy_container_apps=true`
9. `terraform apply`
10. vérifier `GET /v1/health`
11. enregistrer la redirect URI Microsoft
12. lancer onboarding Microsoft
13. lancer scan web
14. lancer scan infra Azure
15. générer PDF
16. vérifier DLQ à zéro
17. exécuter tests de charge et pentest

## 5. Build/push images

```bash
ACR_LOGIN_SERVER="$(terraform output -raw acr_login_server)"
az acr login --name "$(echo "$ACR_LOGIN_SERVER" | cut -d. -f1)"
```

API :

```bash
cd ../bevoac-api-enterprise
npm install
npm run check
docker build --platform linux/amd64 -t "$ACR_LOGIN_SERVER/bevoac-api-enterprise:v5.1.0" .
docker push "$ACR_LOGIN_SERVER/bevoac-api-enterprise:v5.1.0"
```

Worker :

```bash
cd ../bevoac-worker-enterprise
npm install
npm run check
docker build --platform linux/amd64 -t "$ACR_LOGIN_SERVER/bevoac-worker-enterprise:v5.1.0" .
docker push "$ACR_LOGIN_SERVER/bevoac-worker-enterprise:v5.1.0"
```

Dans `terraform.tfvars` :

```hcl
api_image    = "<acr>.azurecr.io/bevoac-api-enterprise:v5.1.0"
worker_image = "<acr>.azurecr.io/bevoac-worker-enterprise:v5.1.0"
deploy_container_apps = true
```

## 6. Contrat API/worker

Le contrat de message doit être aligné entre API et worker.

Source recommandée :

```text
contracts/scan-message-version.json
```

Valeur V5.1 :

```text
2026-05-06-production-hardening-v5
```

Avant build :

```bash
node scripts/sync-contracts.js
grep -R "2026-05-06-production-hardening-v5" -n bevoac-api-enterprise bevoac-worker-enterprise contracts
```

Une désynchronisation entre API et worker envoie les messages en DLQ avec une erreur de validation `/version`.

## 7. Admin OIDC

Configurer une App Registration dédiée à l'admin API :

- Application ID URI : `api://<admin-app-client-id>`
- App role : `Bevoac.Admin`
- Affectation : groupe ou utilisateur admin Bevoac
- Azure CLI autorisé uniquement pour tests opérateur si nécessaire

Tester le token :

```bash
ADMIN_TOKEN=$(az account get-access-token \
  --resource "api://<admin-app-client-id>" \
  --query accessToken \
  -o tsv)
```

Décoder :

```bash
export ADMIN_TOKEN
python3 - <<'PY'
import os, json, base64
token=os.environ["ADMIN_TOKEN"]
payload=token.split(".")[1]
payload += "=" * (-len(payload) % 4)
data=json.loads(base64.urlsafe_b64decode(payload.encode()))
print(json.dumps({key:data.get(key) for key in ["aud","iss","roles","scp"]}, indent=2))
PY
```

Aligner `admin_oidc_issuer`, `admin_oidc_audience` et `admin_oidc_required_roles` sur le token réel.

## 8. Private endpoints

Avec :

```hcl
enable_private_endpoints      = true
enable_postgres_public_access = false
```

les plans/apply Terraform depuis un Mac hors VNet peuvent échouer sur Key Vault ou PostgreSQL.

Comportement attendu production :

- Terraform depuis runner privé/VNet/VPN.
- Scripts DB depuis réseau privé.
- Pas d'accès public Key Vault/PostgreSQL.

Exception POC temporaire :

```bash
az keyvault update -g <rg> -n <kv> --public-network-access Enabled
```

et/ou règle firewall PostgreSQL temporaire, puis fermeture immédiate après intervention.

## 9. Service Bus sessions

`enable_service_bus_sessions=true` doit être activé avant trafic production.

Contrôler :

```bash
az servicebus queue show \
  --resource-group <rg> \
  --namespace-name <namespace-short> \
  --name scan-jobs \
  --query "{requiresSession:requiresSession,active:countDetails.activeMessageCount,deadLetter:countDetails.deadLetterMessageCount}" \
  -o json
```

Attendu :

```json
{"requiresSession":true,"active":0,"deadLetter":0}
```

## 10. Rollback

- Conserver les tags d'images précédents.
- Ne pas supprimer `scan_results` ni `scan_attempts`.
- Ne pas recréer la queue Service Bus si elle contient des messages actifs.
- Revenir à l'image précédente via Terraform.
- Si l'incident concerne le contrat de message, figer API et worker sur une même version.
- Si DLQ contient des messages dus à un ancien contrat, purger ou rejouer selon décision d'exploitation.

## 11. Checklist de fin de déploiement

```bash
curl -i "$API_BASE_URL/v1/health"
```

Puis :

- admin OIDC OK ;
- tenant/API key générés ;
- target web enregistré ;
- onboarding Azure terminé ;
- scan web DONE ;
- scan infra DONE ;
- PDF généré ;
- Service Bus `active=0`, `deadLetter=0` ;
- logs API/worker sans erreurs critiques ;
- API key de test non exposée avant démo ;
- Key Vault/PostgreSQL refermés selon posture cible.
