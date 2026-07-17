#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
RESOURCE_GROUP="${RESOURCE_GROUP:-$(terraform output -raw resource_group_name 2>/dev/null || true)}"
KEY_VAULT_NAME="${KEY_VAULT_NAME:-$(terraform output -raw key_vault_name 2>/dev/null || true)}"
POSTGRES_FQDN="${POSTGRES_FQDN:-$(terraform output -raw postgres_fqdn 2>/dev/null || true)}"

[[ -n "$RESOURCE_GROUP" ]] || { echo "[ERROR] RESOURCE_GROUP not set and Terraform output unavailable." >&2; exit 1; }
[[ -n "$KEY_VAULT_NAME" ]] || { echo "[ERROR] KEY_VAULT_NAME not set and Terraform output unavailable." >&2; exit 1; }

echo "[INFO] Resource group: ${RESOURCE_GROUP}"
echo "[INFO] Key Vault: ${KEY_VAULT_NAME}"

kv_state=$(az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.publicNetworkAccess" -o tsv 2>/dev/null || echo "UNKNOWN")
echo "[INFO] Key Vault publicNetworkAccess=${kv_state}"

if [[ "$kv_state" == "Disabled" ]]; then
  echo "[WARN] Key Vault public network access is disabled."
  echo "[WARN] Terraform plan/apply from a public workstation may fail while refreshing azurerm_key_vault_secret resources."
  echo "[ACTION] Run Terraform from a VM/runner/VPN inside the VNet, or use a documented temporary access window for POC only."
fi

if [[ -n "$POSTGRES_FQDN" ]]; then
  echo "[INFO] PostgreSQL FQDN: ${POSTGRES_FQDN}"
fi

echo "[OK] Terraform private network preflight completed."
