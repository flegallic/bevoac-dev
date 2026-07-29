# BEVOAC - Runbook V5.3 Production Ready Ultime

Version: V5.3.0-production-acceptance  
Audience: administrateur Bevoac, CTO, RSSI, architecte cloud, intégrateur B2B, support client entreprise.

## 0. Positionnement exact

Bevoac V5.3 est une API SaaS Azure-first de scan d'audit sécurité, utilisable en production contrôlée ou pilote B2B avancé lorsque les risques résiduels documentés sont acceptés. Le produit ne doit pas être présenté comme certifié enterprise complet tant que pentest, charge multi-tenant, DR, RLS strict ou équivalent, et procédures incident ne sont pas prouvés.

## 1. Socle livré V5.3

- API et worker `5.3.0-production-acceptance`.
- Idempotency key serveur et client.
- Transactional outbox avec publisher dédié optionnel et recommandé.
- Contrats API/worker synchronisés.
- Migrations versionnées.
- Billing `scan_reserved -> scan_consumed / scan_refunded`.
- Worker idempotent avec `scan_attempts`.
- Retry/backoff Azure/Graph.
- Retention Container Apps Job.
- Azure Monitor alerts.
- APIM optionnel avec mode double-auth explicite.
- CI API/worker/Terraform.
- Tenant isolation guardrails et `check:tenant-isolation`.
- k6 multi-tenant load proof.

## 2. Architecture cible V5.3

Voir `docs/mermaid/architecture_v5_3.mmd` et `docs/diagrams/architecture_v5_3.png`.

Flux résumé:

```text
Client / intégrateur
 -> APIM optionnel
 -> API Fastify /v1
 -> API key -> tenant Bevoac
 -> allowlist web/Azure
 -> idempotency + billing RESERVED + outbox_events
 -> dedicated outbox publisher
 -> Service Bus sessions + DLQ
 -> worker idempotent
 -> scan_results + billing CONSUMED/REFUNDED
 -> JSON API + PDF
```

## 3. Déploiement et images

Les images doivent être taguées de façon immutable. Éviter `latest`.

```bash
cd bevoac-iac-enterprise
export ACR_LOGIN_SERVER="$(terraform output -raw acr_login_server)"
export ACR_NAME="$(echo "$ACR_LOGIN_SERVER" | cut -d. -f1)"
export IMAGE_TAG="v5.3.0-production-acceptance-$(date +%Y%m%d%H%M)"
az acr login --name "$ACR_NAME"

cd ../bevoac-api-enterprise
npm install
npm run check
npm test
docker build --platform linux/amd64 -t "$ACR_LOGIN_SERVER/bevoac-api-enterprise:$IMAGE_TAG" .
docker push "$ACR_LOGIN_SERVER/bevoac-api-enterprise:$IMAGE_TAG"

cd ../bevoac-worker-enterprise
npm install
npm run check
docker build --platform linux/amd64 -t "$ACR_LOGIN_SERVER/bevoac-worker-enterprise:$IMAGE_TAG" .
docker push "$ACR_LOGIN_SERVER/bevoac-worker-enterprise:$IMAGE_TAG"
```

Update `terraform.tfvars`:

```hcl
api_image    = "<acr>.azurecr.io/bevoac-api-enterprise:<tag>"
worker_image = "<acr>.azurecr.io/bevoac-worker-enterprise:<tag>"
enable_dedicated_outbox_publisher = true
```

## 4. Validations locales obligatoires

```bash
cd bevoac-api-enterprise
npm install
npm run check
npm test
npm run migrate-db
npm run check:tenant-isolation

cd ../bevoac-worker-enterprise
npm install
npm run check

cd ../bevoac-iac-enterprise
terraform fmt -recursive
terraform init -backend=false
terraform validate
bash scripts/static-hardening-check.sh
```

## 5. Terraform et Key Vault privé

Si Key Vault public access est désactivé, `terraform plan` échoue depuis un poste hors VNet. Le modèle nominal production est un runner privé, une VM admin dans le VNet ou un VPN/ExpressRoute. L'ouverture publique temporaire est une exception POC/diagnostic à refermer immédiatement.

```bash
cd bevoac-iac-enterprise
bash scripts/terraform-private-network-preflight.sh
```

## 6. APIM

Deux modes sont supportés:

| Mode | Terraform | Headers client |
|---|---|---|
| Double-auth gateway | `apim_subscription_required = true` | `Ocp-Apim-Subscription-Key` + `Authorization: Bearer <Bevoac API key>` |
| Auth Bevoac seule | `apim_subscription_required = false` | `Authorization: Bearer <Bevoac API key>` |

Smoke test:

```bash
cd bevoac-iac-enterprise
export APIM_URL="$(terraform output -raw apim_gateway_url)"
export APIM_SUBSCRIPTION_REQUIRED="$(terraform output -raw apim_subscription_required)"
export BEVOAC_API_KEY="biv_live_..."
export APIM_SUBSCRIPTION_KEY="$(bash scripts/get-apim-subscription-key.sh)"
bash scripts/apim-smoke-test.sh
```

## 7. Tests client minimaux

```bash
curl -s -o /tmp/no-auth.json -w "%{http_code}
" "$API_BASE_URL/v1/scans"
curl -s -o /tmp/bad-auth.json -w "%{http_code}
" "$API_BASE_URL/v1/scans" -H "Authorization: Bearer invalid-key"
```

Attendu: `401`.

Créer un scan web avec idempotence serveur:

```bash
RESP=$(curl -s -X POST "$API_BASE_URL/v1/scans"   -H "Authorization: Bearer $BEVOAC_API_KEY"   -H "Content-Type: application/json"   -d '{"cloudProvider":"azure","scanProfile":"web","modules":["web"],"azure":{"targetUrl":"https://example.com"}}')
echo "$RESP" | jq .
export SCAN_ID="$(echo "$RESP" | jq -r .scanId)"
export IDEM="$(echo "$RESP" | jq -r .idempotencyKey)"
```

Rejouer:

```bash
curl -s -X POST "$API_BASE_URL/v1/scans"   -H "Authorization: Bearer $BEVOAC_API_KEY"   -H "Content-Type: application/json"   -H "Idempotency-Key: $IDEM"   -d '{"cloudProvider":"azure","scanProfile":"web","modules":["web"],"azure":{"targetUrl":"https://example.com"}}' | jq .
```

Attendu: même `scanId`, `idempotentReplay=true`.

## 8. Tests admin minimaux

Service Bus:

```bash
export RESOURCE_GROUP="$(terraform output -raw resource_group_name)"
export SERVICEBUS_NAMESPACE="$(terraform output -raw service_bus_namespace_short)"
export SERVICEBUS_QUEUE_NAME="$(terraform output -raw service_bus_queue_name)"
az servicebus queue show --resource-group "$RESOURCE_GROUP" --namespace-name "$SERVICEBUS_NAMESPACE" --name "$SERVICEBUS_QUEUE_NAME" --query "{active:countDetails.activeMessageCount,deadLetter:countDetails.deadLetterMessageCount,transferDeadLetter:countDetails.transferDeadLetterMessageCount,requiresSession:requiresSession}" -o json
```

Outbox publisher:

```bash
terraform output -raw outbox_publisher_container_app_name
az containerapp logs show --resource-group "$RESOURCE_GROUP" --name "$(terraform output -raw outbox_publisher_container_app_name)" --tail 100
```

Tenant isolation:

```bash
cd ../bevoac-api-enterprise
npm run check:tenant-isolation
```

## 9. GO / NO-GO

GO production contrôlée si:

- API, worker et Terraform checks passent.
- Migrations appliquées.
- `check:tenant-isolation` OK.
- Dedicated outbox publisher déployé ou exception signée.
- APIM mode documenté.
- DLQ = 0 hors tests volontaires.
- k6 multi-tenant exécuté et archivé.
- Risques résiduels validés par le propriétaire produit.

NO-GO enterprise strict si:

- pentest non réalisé;
- RLS ou contrôle équivalent non validé;
- charge multi-tenant non prouvée;
- DR/SLO/runbook incident non formalisés;
- logs sensibles non audités.
