#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IAC="$ROOT/bevoac-iac-enterprise"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$ROOT/files/bevoac-v6-1-3-evidence-$STAMP"
STATUS="$OUT/status.txt"
mkdir -p "$OUT"
: > "$STATUS"

record() {
  local name="$1"
  shift
  if "$@" > "$OUT/$name" 2>&1; then
    echo "$name=0" >> "$STATUS"
  else
    local code=$?
    echo "$name=$code" >> "$STATUS"
  fi
}

record_shell() {
  local name="$1"
  shift
  if bash -lc "$*" > "$OUT/$name" 2>&1; then
    echo "$name=0" >> "$STATUS"
  else
    local code=$?
    echo "$name=$code" >> "$STATUS"
  fi
}

safe_output() {
  terraform -chdir="$IAC" output -raw "$1" 2>/dev/null || true
}

cd "$ROOT"
record git.txt bash -lc 'git branch --show-current; git rev-parse HEAD; git status --short; git log -5 --oneline --decorate'
record package-versions.txt python3 - <<'PY'
import json
from pathlib import Path
for relative in (
    'bevoac-api-enterprise/package.json',
    'bevoac-worker-enterprise/package.json',
    'bevoac-frontend-enterprise/package.json',
):
    path = Path(relative)
    if path.exists():
        data = json.loads(path.read_text(encoding='utf-8'))
        print(json.dumps({
            'path': relative,
            'name': data.get('name'),
            'version': data.get('version'),
            'engines': data.get('engines'),
        }, sort_keys=True))
PY
record tools.txt bash -lc 'printf "az="; az version --query "\"azure-cli\"" -o tsv; printf "terraform="; terraform version -json | jq -r .terraform_version; printf "node="; node --version; printf "npm="; npm --version; printf "psql="; psql --version'

RESOURCE_GROUP="$(safe_output resource_group_name)"
KEY_VAULT="$(safe_output key_vault_name)"
POSTGRES_FQDN="$(safe_output postgres_fqdn)"
SB_NAMESPACE="$(safe_output service_bus_namespace_short)"
SB_QUEUE="$(safe_output service_bus_queue_name)"
APIM_URL="$(safe_output apim_gateway_url)"
ACR_LOGIN_SERVER="$(safe_output acr_login_server)"
APIM_NAME="${APIM_URL#https://}"
APIM_NAME="${APIM_NAME%%.*}"
ACR_NAME="${ACR_LOGIN_SERVER%%.*}"
POSTGRES_NAME="${POSTGRES_FQDN%%.*}"

for required in RESOURCE_GROUP KEY_VAULT POSTGRES_FQDN SB_NAMESPACE SB_QUEUE APIM_URL ACR_LOGIN_SERVER; do
  if [ -z "${!required:-}" ]; then
    echo "missing-output-$required=1" >> "$STATUS"
  fi
done

record terraform-validate.txt terraform -chdir="$IAC" validate
record terraform-state-addresses.txt terraform -chdir="$IAC" state list
record terraform-safe-outputs.json python3 - "$IAC" <<'PY'
import json
import subprocess
import sys
from pathlib import Path
root = Path(sys.argv[1])
names = [
    'resource_group_name', 'acr_login_server', 'api_container_app_name',
    'worker_container_app_name', 'outbox_publisher_container_app_name',
    'retention_job_name', 'admin_api_container_app_name', 'key_vault_name',
    'postgres_fqdn', 'service_bus_namespace_short', 'service_bus_queue_name',
    'apim_gateway_url', 'frontend_url', 'enterprise_runtime_database_roles',
    'service_bus_identity_only_auth'
]
result = {}
for name in names:
    process = subprocess.run(
        ['terraform', 'output', '-json', name], cwd=root,
        text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        check=False,
    )
    if process.returncode == 0:
        try:
            result[name] = json.loads(process.stdout)
        except json.JSONDecodeError:
            result[name] = process.stdout.strip()
print(json.dumps(result, indent=2, sort_keys=True))
PY
record azure-account.json az account show --query '{subscription:id,tenant:tenantId,userType:user.type}' -o json

if [ -n "$RESOURCE_GROUP" ]; then
  APP_NAMES="$(az containerapp list -g "$RESOURCE_GROUP" --query '[].name' -o tsv 2>/dev/null || true)"
  for app in $APP_NAMES; do
    export RESOURCE_GROUP app
    record_shell "containerapp-$app-safe.json" 'az containerapp show -g "$RESOURCE_GROUP" -n "$app" -o json | jq '\''{
      name:.name,
      location:.location,
      image:.properties.template.containers[0].image,
      revisionMode:.properties.configuration.activeRevisionsMode,
      latestRevision:.properties.latestRevisionName,
      identityResourceIds:(.identity.userAssignedIdentities // {} | keys),
      ingress:{external:.properties.configuration.ingress.external,fqdn:.properties.configuration.ingress.fqdn},
      env:[.properties.template.containers[0].env[]? |
        if .secretRef then {name:.name,secretRef:.secretRef}
        elif (["NODE_ENV","APP_RUNTIME_MODE","PG_HOST","PG_PORT","PG_DATABASE","PG_USER","PG_SSL_MODE","SERVICEBUS_AUTH_MODE","SERVICEBUS_FQ_NAMESPACE","SERVICEBUS_QUEUE_NAME","SERVICEBUS_SESSIONS_ENABLED","AZURE_CLIENT_ID","HOST","PORT"] | index(.name))
        then {name:.name,value:.value}
        else {name:.name,value:"<redacted-non-secret>"}
        end]
    }'\'''
    record_shell "revisions-$app-safe.json" 'az containerapp revision list -g "$RESOURCE_GROUP" -n "$app" -o json | jq '\''[.[] | {name:.name,active:.properties.active,runningState:.properties.runningState,createdTime:.properties.createdTime,image:.properties.template.containers[0].image,fqdn:(.properties.fqdn // null)}]'\'''
    record "traffic-$app.json" az containerapp ingress traffic show -g "$RESOURCE_GROUP" -n "$app" -o json
  done

  JOB_NAMES="$(az containerapp job list -g "$RESOURCE_GROUP" --query '[].name' -o tsv 2>/dev/null || true)"
  for job in $JOB_NAMES; do
    export RESOURCE_GROUP job
    record_shell "job-$job-safe.json" 'az containerapp job show -g "$RESOURCE_GROUP" -n "$job" -o json | jq '\''{
      name:.name,
      image:.properties.template.containers[0].image,
      identityResourceIds:(.identity.userAssignedIdentities // {} | keys),
      triggerType:.properties.configuration.triggerType,
      env:[.properties.template.containers[0].env[]? |
        if .secretRef then {name:.name,secretRef:.secretRef}
        elif (["NODE_ENV","APP_RUNTIME_MODE","PG_HOST","PG_PORT","PG_DATABASE","PG_USER","PG_SSL_MODE","DRY_RUN"] | index(.name))
        then {name:.name,value:.value}
        else {name:.name,value:"<redacted-non-secret>"}
        end]
    }'\'''
  done

  record identities-safe.json az identity list -g "$RESOURCE_GROUP" --query '[].{name:name,clientId:clientId,principalId:principalId,id:id}' -o json
  IDENTITY_ROWS="$(az identity list -g "$RESOURCE_GROUP" --query '[].{name:name,principalId:principalId}' -o tsv 2>/dev/null || true)"
  while IFS=$'\t' read -r identity_name principal_id; do
    [ -n "$identity_name" ] || continue
    record "rbac-$identity_name.json" az role assignment list --assignee-object-id "$principal_id" --all --query '[].{role:roleDefinitionName,scope:scope,principalType:principalType}' -o json
  done <<< "$IDENTITY_ROWS"

  if [ -n "$KEY_VAULT" ]; then
    record keyvault-safe.json az keyvault show -g "$RESOURCE_GROUP" -n "$KEY_VAULT" --query '{name:name,publicNetworkAccess:properties.publicNetworkAccess,enableRbacAuthorization:properties.enableRbacAuthorization,networkAcls:properties.networkAcls,privateEndpointConnections:properties.privateEndpointConnections[].{id:id,status:properties.privateLinkServiceConnectionState.status}}' -o json
  fi
  if [ -n "$POSTGRES_NAME" ]; then
    record postgres-safe.json az postgres flexible-server show -g "$RESOURCE_GROUP" -n "$POSTGRES_NAME" --query '{name:name,version:version,state:state,sku:sku.name,publicNetworkAccess:network.publicNetworkAccess,delegatedSubnetResourceId:network.delegatedSubnetResourceId,privateDnsZoneArmResourceId:network.privateDnsZoneArmResourceId,backupRetentionDays:backup.backupRetentionDays,geoRedundantBackup:backup.geoRedundantBackup}' -o json
    record postgres-firewall.json az postgres flexible-server firewall-rule list -g "$RESOURCE_GROUP" -n "$POSTGRES_NAME" --query '[].{name:name,startIpAddress:startIpAddress,endIpAddress:endIpAddress}' -o json
  fi
  record private-endpoints-safe.json az network private-endpoint list -g "$RESOURCE_GROUP" --query '[].{name:name,subnet:subnet.id,connections:privateLinkServiceConnections[].{name:name,resourceId:privateLinkServiceId,groupIds:groupIds,state:privateLinkServiceConnectionState.status}}' -o json
  record private-dns-safe.json az network private-dns zone list -g "$RESOURCE_GROUP" --query '[].{name:name,numberOfRecordSets:numberOfRecordSets,maxNumberOfRecordSets:maxNumberOfRecordSets}' -o json

  if [ -n "$SB_NAMESPACE" ]; then
    record servicebus-safe.json az servicebus namespace show -g "$RESOURCE_GROUP" -n "$SB_NAMESPACE" --query '{name:name,sku:sku.name,status:status,publicNetworkAccess:publicNetworkAccess,disableLocalAuth:disableLocalAuth,minimumTlsVersion:minimumTlsVersion}' -o json
    record servicebus-queue-safe.json az servicebus queue show -g "$RESOURCE_GROUP" --namespace-name "$SB_NAMESPACE" -n "$SB_QUEUE" --query '{name:name,requiresSession:requiresSession,active:countDetails.activeMessageCount,deadLetter:countDetails.deadLetterMessageCount,scheduled:countDetails.scheduledMessageCount,maxDeliveryCount:maxDeliveryCount,lockDuration:lockDuration}' -o json
  fi
  if [ -n "$APIM_NAME" ]; then
    record apim-safe.json az apim show -g "$RESOURCE_GROUP" -n "$APIM_NAME" --query '{name:name,sku:sku.name,provisioningState:provisioningState,publicNetworkAccess:publicNetworkAccess,gatewayUrl:gatewayUrl}' -o json
    SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
    record apim-policy.xml az rest --method get --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ApiManagement/service/$APIM_NAME/apis/bevoac-api/policies/policy?api-version=2022-08-01" --query properties.value -o tsv
  fi
  if [ -n "$ACR_NAME" ]; then
    record acr-api-tags.json az acr repository show-tags -n "$ACR_NAME" --repository bevoac-api-enterprise --orderby time_desc --top 20 -o json
    record acr-worker-tags.json az acr repository show-tags -n "$ACR_NAME" --repository bevoac-worker-enterprise --orderby time_desc --top 20 -o json
  fi
fi

if [ "${BEVOAC_COLLECT_DB:-NO}" = "YES" ] && [ -n "$KEY_VAULT" ] && [ -n "$POSTGRES_FQDN" ]; then
  export PG_HOST="$POSTGRES_FQDN"
  export PG_PORT=5432
  export PG_DATABASE=postgres
  export PG_USER="${PG_ADMIN_USER:-bevoacadmin}"
  export PG_SSL_MODE=verify-full
  export PG_PASSWORD="$(az keyvault secret show --vault-name "$KEY_VAULT" --name pg-password --query value -o tsv)"
  record postgres-runtime-boundary.json bash -lc 'cd "$0" && npm run check-db:runtime-boundary' "$ROOT/bevoac-api-enterprise"
  unset PG_PASSWORD
fi

if grep -qv '=0$' "$STATUS"; then
  COMPLETE=false
else
  COMPLETE=true
fi
printf 'COLLECTION_COMPLETE=%s\n' "$COMPLETE" > "$OUT/summary.txt"
printf 'EVIDENCE_CREATED_UTC=%s\n' "$STAMP" >> "$OUT/summary.txt"
(
  cd "$OUT"
  find . -type f ! -name checksums.sha256 -print0 | sort -z | xargs -0 shasum -a 256 > checksums.sha256
)
(
  cd "$(dirname "$OUT")"
  zip -qr "$OUT.zip" "$(basename "$OUT")"
)
echo "COLLECTION_COMPLETE=$COMPLETE"
echo "EVIDENCE_DIR=$OUT"
echo "EVIDENCE_ZIP=$OUT.zip"
[ "$COMPLETE" = "true" ]
