# Guide de deploiement Bevoac V5.1

## 1. Objectif

Deployer Bevoac V5.1 Azure-first pour demonstration ou pilote B2B cadre.

## 2. Prerequis

- Node.js 20 LTS;
- Terraform 1.6+;
- Azure CLI;
- abonnement Azure ou resource group dedie;
- droits pour ACR, Container Apps, Key Vault, Service Bus, PostgreSQL;
- App Registration Microsoft multi-tenant;
- App Registration admin API ou configuration OIDC;
- runner prive/VPN/VM admin si private endpoints fermes.

## 3. Ordre de deploiement recommande

```bash
cd bevoac-iac-enterprise
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=tfplan.bootstrap
terraform apply tfplan.bootstrap
```

Premier bootstrap si ACR vide:

```hcl
deploy_container_apps = false
```

Puis:

1. build image API;
2. push ACR;
3. build image worker;
4. push ACR;
5. configurer `api_image` et `worker_image`;
6. activer `deploy_container_apps=true`;
7. `terraform plan/apply`;
8. initialiser PostgreSQL;
9. verifier `/v1/health`;
10. enregistrer redirect URI Microsoft;
11. lancer onboarding;
12. lancer scan web;
13. lancer scan infra;
14. generer PDF;
15. verifier DLQ zero.

## 4. Configuration production-oriented recommandee pour pilote

```hcl
environment                    = "pilot"
enable_private_endpoints       = true
enable_postgres_public_access  = false
enable_service_bus_sessions    = true
admin_auth_mode                = "oidc"
log_retention_days             = 90
```

## 5. Variables critiques

- `MICROSOFT_CLIENT_ID`;
- `MICROSOFT_CLIENT_SECRET`;
- `ONBOARDING_STATE_SECRET`;
- `ADMIN_OIDC_ISSUER`;
- `ADMIN_OIDC_AUDIENCE`;
- `ADMIN_OIDC_REQUIRED_ROLES`;
- `PG_SSL_MODE=verify-full`;
- `SERVICEBUS_AUTH_MODE=managed_identity`.

## 6. Controle post-deploiement

```bash
curl -i "$API_BASE_URL/v1/health"
az servicebus queue show --resource-group "$RESOURCE_GROUP" --namespace-name "$SERVICE_BUS_NAMESPACE_SHORT" --name scan-jobs
```

Attendus:

- API HTTP 200;
- queue active=0 apres traitement;
- deadLetter=0;
- logs API/worker sans erreurs critiques;
- PDF generable;
- JSON disponible.

## 7. Limites

Ce guide ne prouve pas a lui seul:

- pentest;
- load test;
- backup/restore;
- CI/CD;
- production enterprise.
