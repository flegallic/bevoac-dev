# Bevoac V5.3 - Terraform and private Key Vault operations

## Problem

When Key Vault public network access is disabled, Terraform refresh can fail from a public workstation while reading `azurerm_key_vault_secret` resources.

## Nominal production model

Run Terraform from one of:

- private GitHub runner in the VNet;
- Azure VM admin host in the VNet;
- operator workstation connected through VPN/ExpressRoute;
- controlled CI/CD identity with private endpoint access.

## Preflight

```bash
cd bevoac-iac-enterprise
bash scripts/terraform-private-network-preflight.sh
```

## POC exception

Temporary public access to Key Vault may be used only for POC/diagnostic and must be closed immediately after `terraform apply`.


> Documentation V5.3 alignment note: this file is part of the active V5.3 documentation set. V5.2 equivalents are historical references only.
