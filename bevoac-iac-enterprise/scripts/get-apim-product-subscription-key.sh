#!/usr/bin/env bash
set -euo pipefail

: "${RESOURCE_GROUP:?Set RESOURCE_GROUP, for example rg-bevoac-prod}"
: "${APIM_NAME:?Set APIM_NAME, for example apim-bevoac-prod}"

AZURE_SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-$(az account show --query id -o tsv)}"
APIM_PRODUCT_ID="${APIM_PRODUCT_ID:-bevoac-product}"
APIM_SUBSCRIPTION_ID="${APIM_SUBSCRIPTION_ID:-bevoac-client-test}"
APIM_SUBSCRIPTION_DISPLAY_NAME="${APIM_SUBSCRIPTION_DISPLAY_NAME:-Bevoac Client Test Subscription}"
API_VERSION="2022-08-01"

az rest \
  --method put \
  --url "https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ApiManagement/service/${APIM_NAME}/subscriptions/${APIM_SUBSCRIPTION_ID}?api-version=${API_VERSION}" \
  --body "{\"properties\":{\"displayName\":\"${APIM_SUBSCRIPTION_DISPLAY_NAME}\",\"scope\":\"/products/${APIM_PRODUCT_ID}\",\"state\":\"active\",\"allowTracing\":false}}" \
  --output none

az rest \
  --method post \
  --url "https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ApiManagement/service/${APIM_NAME}/subscriptions/${APIM_SUBSCRIPTION_ID}/listSecrets?api-version=${API_VERSION}" \
  --query primaryKey \
  -o tsv
