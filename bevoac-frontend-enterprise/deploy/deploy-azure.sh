#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="${1:-$SCRIPT_DIR/prod.env}"

if [[ "${CONFIRM_DEMO_ONLY_DEPLOY:-}" != "YES" ]]; then
  cat >&2 <<'MSG'
BLOCKED: this frontend is DEMO-ONLY in Bevoac V6.2.0.
It is not a customer production portal and it must not receive customer API keys.
Set CONFIRM_DEMO_ONLY_DEPLOY=YES only for an explicitly approved demo deployment.
MSG
  exit 2
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing config file: $CONFIG_FILE" >&2
  echo "Create it from: $SCRIPT_DIR/prod.env.example" >&2
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
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required variable: $var_name" >&2
    exit 1
  fi
done

command -v az >/dev/null 2>&1 || { echo "Azure CLI is required." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker is required." >&2; exit 1; }

if [[ "$FRONTEND_IMAGE_TAG" == "latest" ]]; then
  echo "FRONTEND_IMAGE_TAG=latest is forbidden." >&2
  exit 1
fi

IMAGE="$ACR_LOGIN_SERVER/$FRONTEND_IMAGE_NAME:$FRONTEND_IMAGE_TAG"

echo "DEMO_ONLY_DEPLOYMENT=true"
echo "Checking Azure account and existing resources..."
az account show >/dev/null
az group show -n "$AZURE_RESOURCE_GROUP" >/dev/null
az acr show -g "$AZURE_RESOURCE_GROUP" -n "$ACR_NAME" >/dev/null
az containerapp env show -g "$AZURE_RESOURCE_GROUP" -n "$CONTAINER_APP_ENV" >/dev/null

az acr login --name "$ACR_NAME"
docker build --platform linux/amd64 -t "$IMAGE" "$PROJECT_DIR"
docker push "$IMAGE"

if ! az identity show -g "$AZURE_RESOURCE_GROUP" -n "$MANAGED_IDENTITY_NAME" >/dev/null 2>&1; then
  az identity create -g "$AZURE_RESOURCE_GROUP" -n "$MANAGED_IDENTITY_NAME" >/dev/null
fi

IDENTITY_ID="$(az identity show -g "$AZURE_RESOURCE_GROUP" -n "$MANAGED_IDENTITY_NAME" --query id -o tsv)"
PRINCIPAL_ID="$(az identity show -g "$AZURE_RESOURCE_GROUP" -n "$MANAGED_IDENTITY_NAME" --query principalId -o tsv)"
ACR_ID="$(az acr show -g "$AZURE_RESOURCE_GROUP" -n "$ACR_NAME" --query id -o tsv)"

if [[ "$(az role assignment list --assignee "$PRINCIPAL_ID" --scope "$ACR_ID" --query "[?roleDefinitionName=='AcrPull'] | length(@)" -o tsv)" != "1" ]]; then
  az role assignment create --assignee "$PRINCIPAL_ID" --role AcrPull --scope "$ACR_ID" >/dev/null
fi

COMMON_ARGS=(
  -g "$AZURE_RESOURCE_GROUP"
  -n "$CONTAINER_APP_NAME"
  --image "$IMAGE"
  --set-env-vars BEVOAC_FRONTEND_MODE=demo-only
)

if az containerapp show -g "$AZURE_RESOURCE_GROUP" -n "$CONTAINER_APP_NAME" >/dev/null 2>&1; then
  az containerapp update "${COMMON_ARGS[@]}" >/dev/null
else
  az containerapp create \
    -g "$AZURE_RESOURCE_GROUP" \
    -n "$CONTAINER_APP_NAME" \
    --environment "$CONTAINER_APP_ENV" \
    --image "$IMAGE" \
    --target-port 3000 \
    --ingress external \
    --registry-server "$ACR_LOGIN_SERVER" \
    --user-assigned "$IDENTITY_ID" \
    --env-vars BEVOAC_FRONTEND_MODE=demo-only >/dev/null
fi

FQDN="$(az containerapp show -g "$AZURE_RESOURCE_GROUP" -n "$CONTAINER_APP_NAME" --query properties.configuration.ingress.fqdn -o tsv)"
DIGEST="$(az acr repository show-manifests --name "$ACR_NAME" --repository "$FRONTEND_IMAGE_NAME" --query "[?tags[?@=='$FRONTEND_IMAGE_TAG']].digest | [0]" -o tsv)"

echo "DEMO_FRONTEND_URL=https://$FQDN"
echo "FRONTEND_IMAGE=$IMAGE"
echo "FRONTEND_IMAGE_DIGEST=$DIGEST"
echo "CUSTOMER_PRODUCTION_PORTAL=false"
