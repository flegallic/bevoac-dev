#!/usr/bin/env bash
set -euo pipefail

: "${RESOURCE_GROUP:?Set RESOURCE_GROUP}"
: "${APIM_NAME:?Set APIM_NAME, for example apim-bevoac-prod}"
AZURE_SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-$(az account show --query id -o tsv)}"
APIM_SUBSCRIPTION_NAME="${APIM_SUBSCRIPTION_NAME:-}"

if [[ -z "$APIM_SUBSCRIPTION_NAME" ]]; then
  APIM_SUBSCRIPTION_NAME=$(az rest \
    --method get \
    --url "https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ApiManagement/service/${APIM_NAME}/subscriptions?api-version=2022-08-01" \
    --query "value[0].name" -o tsv)
fi

az rest \
  --method post \
  --url "https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ApiManagement/service/${APIM_NAME}/subscriptions/${APIM_SUBSCRIPTION_NAME}/listSecrets?api-version=2022-08-01" \
  --query "primaryKey" -o tsv
