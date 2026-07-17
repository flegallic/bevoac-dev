#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="${1:-$SCRIPT_DIR/prod.env}"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing config file: $CONFIG_FILE"
  echo "Create it from: $SCRIPT_DIR/prod.env.example"
  exit 1
fi

set -a
source "$CONFIG_FILE"
set +a

required_vars=(
  AZURE_RESOURCE_GROUP
  ACR_NAME
  ACR_LOGIN_SERVER
  CONTAINER_APP_ENV
  CONTAINER_APP_NAME
  MANAGED_IDENTITY_NAME
  FRONTEND_IMAGE_NAME
  FRONTEND_IMAGE_TAG
  BEVOAC_API_URL
  BEVOAC_ALLOWED_API_HOSTS
  BEVOAC_API_KEY_HEADER
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required variable: $var_name"
    exit 1
  fi
done

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI is required."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required."
  exit 1
fi

echo "Checking Azure account..."
az account show >/dev/null

IMAGE="$ACR_LOGIN_SERVER/$FRONTEND_IMAGE_NAME:$FRONTEND_IMAGE_TAG"

echo "Checking existing Azure resources..."
az group show -n "$AZURE_RESOURCE_GROUP" >/dev/null
az acr show -g "$AZURE_RESOURCE_GROUP" -n "$ACR_NAME" >/dev/null
az containerapp env show -g "$AZURE_RESOURCE_GROUP" -n "$CONTAINER_APP_ENV" >/dev/null

echo "Logging in to ACR: $ACR_NAME"
az acr login --name "$ACR_NAME"

echo "Building image: $IMAGE"
docker build --platform linux/amd64 -t "$IMAGE" "$PROJECT_DIR"

echo "Pushing image: $IMAGE"
docker push "$IMAGE"

echo "Ensuring managed identity exists: $MANAGED_IDENTITY_NAME"
if ! az identity show -g "$AZURE_RESOURCE_GROUP" -n "$MANAGED_IDENTITY_NAME" >/dev/null 2>&1; then
  az identity create -g "$AZURE_RESOURCE_GROUP" -n "$MANAGED_IDENTITY_NAME" >/dev/null
fi

IDENTITY_ID="$(az identity show -g "$AZURE_RESOURCE_GROUP" -n "$MANAGED_IDENTITY_NAME" --query id -o tsv)"
PRINCIPAL_ID="$(az identity show -g "$AZURE_RESOURCE_GROUP" -n "$MANAGED_IDENTITY_NAME" --query principalId -o tsv)"
ACR_ID="$(az acr show -g "$AZURE_RESOURCE_GROUP" -n "$ACR_NAME" --query id -o tsv)"

echo "Ensuring AcrPull permission is assigned..."
if ! az role assignment list \
  --assignee "$PRINCIPAL_ID" \
  --scope "$ACR_ID" \
  --query "[?roleDefinitionName=='AcrPull'] | length(@)" \
  -o tsv | grep -q '^1$'; then
  az role assignment create \
    --assignee "$PRINCIPAL_ID" \
    --role AcrPull \
    --scope "$ACR_ID" >/dev/null
fi

if az containerapp show -g "$AZURE_RESOURCE_GROUP" -n "$CONTAINER_APP_NAME" >/dev/null 2>&1; then
  echo "Updating Container App: $CONTAINER_APP_NAME"
  az containerapp update \
    -g "$AZURE_RESOURCE_GROUP" \
    -n "$CONTAINER_APP_NAME" \
    --image "$IMAGE" \
    --set-env-vars \
      BEVOAC_API_URL="$BEVOAC_API_URL" \
      BEVOAC_ALLOWED_API_HOSTS="$BEVOAC_ALLOWED_API_HOSTS" \
      BEVOAC_API_KEY_HEADER="$BEVOAC_API_KEY_HEADER" >/dev/null
else
  echo "Creating Container App: $CONTAINER_APP_NAME"
  az containerapp create \
    -g "$AZURE_RESOURCE_GROUP" \
    -n "$CONTAINER_APP_NAME" \
    --environment "$CONTAINER_APP_ENV" \
    --image "$IMAGE" \
    --target-port 3000 \
    --ingress external \
    --registry-server "$ACR_LOGIN_SERVER" \
    --user-assigned "$IDENTITY_ID" \
    --env-vars \
      BEVOAC_API_URL="$BEVOAC_API_URL" \
      BEVOAC_ALLOWED_API_HOSTS="$BEVOAC_ALLOWED_API_HOSTS" \
      BEVOAC_API_KEY_HEADER="$BEVOAC_API_KEY_HEADER" >/dev/null
fi

FQDN="$(az containerapp show \
  -g "$AZURE_RESOURCE_GROUP" \
  -n "$CONTAINER_APP_NAME" \
  --query properties.configuration.ingress.fqdn \
  -o tsv)"

echo
echo "Deployment complete."
echo "Frontend URL: https://$FQDN"
