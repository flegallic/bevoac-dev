#!/usr/bin/env bash
set -euo pipefail

# Bevoac local .env generator.
# This script is for local administration only. Azure Container Apps runtime is
# configured by Terraform variables/secrets, not by this .env file.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IAC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_DIR="$(cd "$IAC_DIR/.." && pwd)"

API_DIR=""
for candidate in "$PACKAGE_DIR/bevoac-api-entreprise" "$PACKAGE_DIR/bevoac-api-enterprise"; do
  if [ -f "$candidate/package.json" ]; then
    API_DIR="$candidate"
    break
  fi
done

if [ -z "$API_DIR" ]; then
  echo "ERROR: API directory not found next to $IAC_DIR." >&2
  echo "Expected bevoac-api-entreprise or bevoac-api-enterprise." >&2
  exit 1
fi

cd "$IAC_DIR"

required_output() {
  local name="$1"
  local value
  value="$(terraform output -raw "$name" 2>/dev/null || true)"
  if [ -z "$value" ] || [ "$value" = "null" ]; then
    echo "ERROR: terraform output '$name' is empty. Run terraform apply first." >&2
    exit 1
  fi
  printf '%s' "$value"
}

RG="$(required_output resource_group_name)"
KV_NAME="$(required_output key_vault_name)"
PG_HOST="$(required_output postgres_fqdn)"
SB_FQ_NAMESPACE="$(required_output service_bus_namespace)"
FRONTEND_URL="$(required_output frontend_url)"
API_BASE_URL="$(required_output onboarding_redirect_uri)"
ONBOARDING_REDIRECT_URI="$(required_output onboarding_redirect_callback_uri)"
ONBOARDING_FRONTEND_SUCCESS_URL="$(required_output onboarding_success_url)"

FRONTEND_BASE_URL="${FRONTEND_URL%/}"
SB_NAMESPACE="${SB_FQ_NAMESPACE%%.servicebus.windows.net}"

secret_value() {
  local name="$1"
  az keyvault secret show \
    --vault-name "$KV_NAME" \
    --name "$name" \
    --query value \
    -o tsv
}

PG_PASSWORD="$(secret_value pg-password)"
ADMIN_API_SECRET="$(secret_value admin-api-secret)"
MICROSOFT_CLIENT_SECRET="$(secret_value microsoft-client-secret)"
ONBOARDING_STATE_SECRET="$(secret_value onboarding-state-secret)"

SERVICEBUS_CONNECTION_STRING="$(az servicebus namespace authorization-rule keys list \
  --resource-group "$RG" \
  --namespace-name "$SB_NAMESPACE" \
  --name RootManageSharedAccessKey \
  --query primaryConnectionString \
  -o tsv)"

MICROSOFT_CLIENT_ID="$(grep -E '^microsoft_client_id[[:space:]]*=' terraform.tfvars | sed -E 's/.*=[[:space:]]*"([^"]+)".*/\1/' || true)"
if [ -z "$MICROSOFT_CLIENT_ID" ]; then
  echo "ERROR: microsoft_client_id not found in terraform.tfvars." >&2
  exit 1
fi

ENV_FILE="$API_DIR/.env"
umask 077
cat > "$ENV_FILE" <<ENVEOF
# ============================================================
# BEVOAC API - local administration .env
# Generated from Terraform outputs, Azure Key Vault and Azure Service Bus.
# Do not commit. Do not use as Azure runtime configuration.
# Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ============================================================

NODE_ENV=development
HOST=0.0.0.0
PORT=8080
LOG_LEVEL=info

PG_HOST=$PG_HOST
PG_PORT=5432
PG_DATABASE=postgres
PG_USER=bevoacadmin
PG_PASSWORD=$PG_PASSWORD
PG_SSL_MODE=require

SERVICEBUS_AUTH_MODE=connection_string
SERVICEBUS_CONNECTION_STRING=$SERVICEBUS_CONNECTION_STRING
SERVICEBUS_QUEUE_NAME=scan-jobs
SERVICEBUS_MESSAGE_TTL_SECONDS=300

ADMIN_API_SECRET=$ADMIN_API_SECRET

MICROSOFT_CLIENT_ID=$MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET=$MICROSOFT_CLIENT_SECRET
MICROSOFT_ADMIN_CONSENT_SCOPE=https://graph.microsoft.com/.default

API_PUBLIC_BASE_URL=$API_BASE_URL
ONBOARDING_REDIRECT_URI=$ONBOARDING_REDIRECT_URI
ONBOARDING_FRONTEND_SUCCESS_URL=$ONBOARDING_FRONTEND_SUCCESS_URL
ONBOARDING_ALLOW_INFER_REDIRECT_URI=false
ONBOARDING_STATE_SECRET=$ONBOARDING_STATE_SECRET
ONBOARDING_STATE_TTL_MINUTES=20
ONBOARDING_AZURE_REQUEST_TIMEOUT_MS=15000

ALLOWED_ORIGINS=$FRONTEND_BASE_URL

API_RATE_LIMIT_MAX=60
API_RATE_LIMIT_WINDOW=1 minute
ADMIN_RATE_LIMIT_MAX=20
ADMIN_RATE_LIMIT_WINDOW=1 minute

DEFAULT_PLAN_FREE_QUOTA=30
DEFAULT_PLAN_STANDARD_QUOTA=2500
DEFAULT_PLAN_BUSINESS_QUOTA=10000

DEFAULT_PLAN_FREE_RESOURCE_LIMIT=10
DEFAULT_PLAN_STANDARD_RESOURCE_LIMIT=500
DEFAULT_PLAN_BUSINESS_RESOURCE_LIMIT=2500
DEFAULT_PLAN_PAYG_RESOURCE_LIMIT=

PAYG_UNIT_PRICE_EUR=0.10
ENVEOF
chmod 600 "$ENV_FILE"

cat <<MSG
[OK] Generated $ENV_FILE
API_PUBLIC_BASE_URL=$API_BASE_URL
ONBOARDING_REDIRECT_URI=$ONBOARDING_REDIRECT_URI
ONBOARDING_FRONTEND_SUCCESS_URL=$ONBOARDING_FRONTEND_SUCCESS_URL

Use API_PUBLIC_BASE_URL in the frontend API field.
Register ONBOARDING_REDIRECT_URI in Microsoft Entra App Registration.
MSG
