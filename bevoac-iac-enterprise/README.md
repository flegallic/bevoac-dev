# Bevoac Azure IaC Enterprise V4

Terraform Azure pour le control plane Bevoac B2B : Container Apps, ACR, Key Vault, PostgreSQL, Service Bus, NAT Gateway, Log Analytics et frontend d'onboarding.

## Ressources principales

- Resource Group
- Log Analytics Workspace
- Azure Container Registry Premium, admin désactivé
- Key Vault avec RBAC, purge protection, secrets applicatifs
- User Assigned Managed Identities API / Worker
- PostgreSQL Flexible Server avec firewall strict
- Service Bus Standard et queue `scan-jobs`
- Azure Container Apps Environment dans VNet
- NAT Gateway pour IP sortante stable
- API Container App public HTTPS
- Worker Container App sans ingress, scale Service Bus
- Storage Account static website pour onboarding client

## Déploiement recommandé

```bash
cd bevoac-iac-enterprise
terraform init
terraform validate
terraform plan -out tfplan
terraform apply tfplan
```

Premier bootstrap :

1. `deploy_container_apps = false`
2. `terraform apply`
3. build/push images dans ACR
4. mettre `api_image` et `worker_image`
5. enregistrer la redirect URI Microsoft exacte
6. `deploy_container_apps = true`
7. `terraform apply`

## Variables obligatoires

```hcl
tenant_id               = "<tenant de déploiement>"
admin_api_secret        = "<32+ chars>"
microsoft_client_id     = "<uuid app registration>"
microsoft_client_secret = "<secret>"
api_public_base_url     = "" # vide = génération automatique depuis Azure Container Apps
```

`api_public_base_url` doit rester vide tant qu’aucun domaine API stable n’existe. Terraform génère automatiquement la base URL depuis Azure Container Apps et injecte `API_PUBLIC_BASE_URL` + `ONBOARDING_REDIRECT_URI` dans la Container App API. En production, l’API refuse d’inférer la callback URL depuis les headers.

## Outputs utiles

```bash
terraform output -raw acr_login_server
terraform output -raw frontend_url
terraform output -raw api_fqdn
terraform output -raw onboarding_redirect_uri
terraform output -raw onboarding_callback_uri_from_generated_aca_fqdn
terraform output -raw onboarding_redirect_callback_uri
```

## Sécurité Azure

- ACR sans compte admin.
- Secrets runtime dans Key Vault.
- API/Worker via Managed Identities.
- PostgreSQL public access limité par firewall à l'egress NAT Container Apps et option IP admin désactivée par défaut.
- Key Vault RBAC activé.
- Container Apps isolées dans un environnement VNet avec NAT stable.

Avant production stricte, évaluer Private Endpoints pour Key Vault/PostgreSQL, alerting Azure Monitor, Defender for Cloud et pipeline CI de validation Terraform.
