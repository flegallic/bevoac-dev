# Terraform et reseau prive V5.2

## Probleme

Quand Key Vault public access est desactive, Terraform lance depuis un poste local hors VNet peut echouer avec `ForbiddenByConnection` pendant le refresh des secrets.

## Mode recommande pilote securise

Executer Terraform depuis:

- une VM admin dans le VNet;
- un runner self-hosted dans le VNet;
- un poste connecte en VPN au VNet;
- un environnement avec resolution Private Link valide.

## Mode POC temporaire

```bash
export MY_IP="$(curl -s ifconfig.me)"
az keyvault update --name kvbevoacpoc --resource-group "$RESOURCE_GROUP" --public-network-access Enabled
az keyvault network-rule add --name kvbevoacpoc --resource-group "$RESOURCE_GROUP" --ip-address "$MY_IP/32"
az keyvault secret show --vault-name kvbevoacpoc --name pg-password --query id -o tsv
terraform plan -out=tfplan
terraform apply tfplan
az keyvault update --name kvbevoacpoc --resource-group "$RESOURCE_GROUP" --public-network-access Disabled
```

## Regle critique

Ne jamais mettre `enable_private_endpoints=false` pour debloquer un plan sans verifier les destructions. Si le plan affiche private endpoints ou private DNS zones `will be destroyed`, ne pas appliquer.
