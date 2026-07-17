#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
RESOURCE_GROUP="${RESOURCE_GROUP:-$(terraform output -raw resource_group_name)}"
POSTGRES_FQDN="${POSTGRES_FQDN:-$(terraform output -raw postgres_fqdn)}"
POSTGRES_SERVER_NAME="${POSTGRES_SERVER_NAME:-${POSTGRES_FQDN%%.*}}"

echo "RESOURCE_GROUP=$RESOURCE_GROUP"
echo "POSTGRES_SERVER_NAME=$POSTGRES_SERVER_NAME"

az postgres flexible-server show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$POSTGRES_SERVER_NAME" \
  --query "{name:name,version:version,backupRetentionDays:backup.backupRetentionDays,storageMb:storage.storageSizeGb,sku:sku.name,publicNetworkAccess:network.publicNetworkAccess}" \
  -o json

echo "--- Available backups (best effort; command availability depends on Azure CLI extension/version) ---"
az postgres flexible-server backup list \
  --resource-group "$RESOURCE_GROUP" \
  --name "$POSTGRES_SERVER_NAME" \
  -o table || echo "[WARN] az postgres flexible-server backup list is not available in this Azure CLI version. Use portal or az postgres flexible-server restore --help for PITR validation."
