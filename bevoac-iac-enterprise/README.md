# Bevoac Azure IaC — V6.1.3 enterprise release

Terraform for the Bevoac Azure control plane: ACR, Container Apps, Managed Identities, Key Vault, PostgreSQL, Service Bus, APIM, monitoring, private endpoints and retention.

## Workload identities

| Workload | PostgreSQL user | Identity |
|---|---|---|
| Public API | `bevoac_api` | API UAMI |
| Worker | `bevoac_worker` | Worker UAMI |
| Outbox | `bevoac_outbox` | Outbox UAMI |
| Retention | `bevoac_retention` | Retention UAMI |
| Admin API | `bevoac_admin_api` | Admin API UAMI |

## Two-phase migration

Use the release script. Do not directly force all security switches in a single first apply.

- `release/v6.1.3-workload-migration.tfvars.example`: dedicated workloads while the legacy rollback path remains temporarily available.
- `release/v6.1.3-security-finalize.tfvars.example`: private Key Vault/PostgreSQL, Service Bus local auth disabled and legacy broad access removed.

```bash
../scripts/release/deploy_v6_1_3.sh help
```

## Validation

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
bash scripts/static-hardening-check.sh
```

Service Bus remains Standard and therefore uses its public endpoint. The final posture disables local/SAS authentication and uses Entra Managed Identity RBAC. Private endpoints for Service Bus require a future Premium-tier decision.
