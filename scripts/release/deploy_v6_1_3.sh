#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IAC="$ROOT/bevoac-iac-enterprise"
API="$ROOT/bevoac-api-enterprise"
WORKER="$ROOT/bevoac-worker-enterprise"
FILES="$ROOT/files"
TAG="${BEVOAC_RELEASE_TAG:-v6.1.3}"
WORKLOAD_PLAN="${BEVOAC_WORKLOAD_PLAN_FILE:-$IAC/tfplan-v6-1-3-workloads}"
SECURITY_PLAN="${BEVOAC_SECURITY_PLAN_FILE:-$IAC/tfplan-v6-1-3-security}"
RELEASE_VARS="$IAC/zz-release-runtime.auto.tfvars.json"
RELEASE_CONTEXT="$FILES/bevoac-v6-1-3-release-context.env"
OBSERVE_SECONDS="${BEVOAC_ROLLOUT_OBSERVE_SECONDS:-60}"
mkdir -p "$FILES"

need() { command -v "$1" >/dev/null 2>&1 || { echo "BLOCKED: required command not found: $1" >&2; exit 1; }; }

node24() {
  if command -v brew >/dev/null 2>&1; then
    local prefix
    prefix="$(brew --prefix node@24 2>/dev/null || true)"
    [ -x "$prefix/bin/node" ] && export PATH="$prefix/bin:$PATH"
  fi
  case "$(node --version 2>/dev/null || true)" in
    v24.*) ;;
    *) echo "BLOCKED: Node.js 24 is required" >&2; exit 1 ;;
  esac
}

context() {
  cd "$ROOT"
  for command in git az terraform jq docker psql curl python3; do need "$command"; done
  node24
  docker buildx version >/dev/null 2>&1 || { echo "BLOCKED: docker buildx is required" >&2; exit 1; }
  git diff --quiet -- || { echo "BLOCKED: tracked Git worktree is not clean" >&2; exit 1; }
  git diff --cached --quiet -- || { echo "BLOCKED: Git index is not empty" >&2; exit 1; }
  az account show --query '{subscription:id,tenant:tenantId,user:user.name}' -o json
}

safe_tf_output() { terraform -chdir="$IAC" output -raw "$1" 2>/dev/null || true; }

outputs() {
  RESOURCE_GROUP="$(safe_tf_output resource_group_name)"
  ACR_LOGIN_SERVER="$(safe_tf_output acr_login_server)"
  API_APP="$(safe_tf_output api_container_app_name)"
  WORKER_APP="$(safe_tf_output worker_container_app_name)"
  OUTBOX_APP="$(safe_tf_output outbox_publisher_container_app_name)"
  RETENTION_JOB="$(safe_tf_output retention_job_name)"
  ADMIN_API_APP="$(safe_tf_output admin_api_container_app_name)"
  KEY_VAULT="$(safe_tf_output key_vault_name)"
  POSTGRES_FQDN="$(safe_tf_output postgres_fqdn)"
  APIM_URL="$(safe_tf_output apim_gateway_url)"
  APIM_SUBSCRIPTION_REQUIRED="$(safe_tf_output apim_subscription_required)"
  SB_NAMESPACE="$(safe_tf_output service_bus_namespace_short)"
  SB_QUEUE="$(safe_tf_output service_bus_queue_name)"
  ACR_NAME="${ACR_LOGIN_SERVER%%.*}"
  for value in RESOURCE_GROUP ACR_LOGIN_SERVER API_APP WORKER_APP OUTBOX_APP RETENTION_JOB KEY_VAULT POSTGRES_FQDN APIM_URL SB_NAMESPACE SB_QUEUE; do
    [ -n "${!value:-}" ] || { echo "BLOCKED: Terraform output is missing: $value" >&2; exit 1; }
  done
  export RESOURCE_GROUP ACR_LOGIN_SERVER ACR_NAME API_APP WORKER_APP OUTBOX_APP RETENTION_JOB
  export ADMIN_API_APP KEY_VAULT POSTGRES_FQDN APIM_URL APIM_SUBSCRIPTION_REQUIRED SB_NAMESPACE SB_QUEUE
}

kv_secret() {
  az keyvault secret show --vault-name "$KEY_VAULT" --name "$1" --query value -o tsv
}

add_local_exclude() {
  local relative="$1" exclude="$ROOT/.git/info/exclude"
  mkdir -p "$(dirname "$exclude")"; touch "$exclude"
  grep -Fxq "$relative" "$exclude" || echo "$relative" >> "$exclude"
}

sanitize_suffix() {
  python3 - "$1" <<'PY'
import re, sys
value = re.sub(r'[^a-z0-9-]+', '-', sys.argv[1].lower()).strip('-')
value = re.sub(r'-+', '-', value)
if not value or not value[0].isalpha(): value = 'r-' + value
print(value[:64].rstrip('-'))
PY
}

stable_revision_name() {
  az containerapp ingress traffic show -g "$RESOURCE_GROUP" -n "$API_APP" \
    --query "[?weight==\`100\`].revisionName | [0]" -o tsv
}

revision_suffix_from_name() {
  local revision="$1"
  case "$revision" in
    "$API_APP"--*) printf '%s\n' "${revision#"$API_APP"--}" ;;
    *) echo "BLOCKED: cannot derive revision suffix from $revision" >&2; return 1 ;;
  esac
}

write_release_vars() {
  local phase="$1" stable_suffix="$2" candidate_suffix="$3"
  local api_image="$ACR_LOGIN_SERVER/bevoac-api-enterprise:$TAG"
  local worker_image="$ACR_LOGIN_SERVER/bevoac-worker-enterprise:$TAG"
  python3 - "$RELEASE_VARS" "$phase" "$api_image" "$worker_image" "$stable_suffix" "$candidate_suffix" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
phase, api_image, worker_image, stable, candidate = sys.argv[2:]
data = {
    'api_image': api_image,
    'worker_image': worker_image,
    'outbox_image': api_image,
    'retention_image': api_image,
    'admin_api_image': api_image,
    'api_stable_revision_suffix': stable,
    'api_revision_suffix': candidate,
    'enable_dedicated_outbox_publisher': True,
    'enable_dedicated_admin_api': True,
    'worker_min_replicas': 0,
    'worker_max_replicas': 8,
    'worker_queue_message_count': 1,
}
if phase == 'workloads':
    data.update({
        'service_bus_local_auth_enabled': True,
        'retain_legacy_servicebus_connection_secret': True,
        'retain_legacy_broad_key_vault_roles': True,
        'retain_legacy_api_servicebus_sender': True,
    })
elif phase == 'security':
    data.update({
        'enable_private_endpoints': True,
        'enable_postgres_public_access': False,
        'enable_db_admin_public_ip_rule': False,
        'service_bus_local_auth_enabled': False,
        'retain_legacy_servicebus_connection_secret': False,
        'retain_legacy_broad_key_vault_roles': False,
        'retain_legacy_api_servicebus_sender': False,
    })
else:
    raise SystemExit(f'unsupported release vars phase: {phase}')
path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
path.chmod(0o600)
PY
  add_local_exclude "bevoac-iac-enterprise/$(basename "$RELEASE_VARS")"
}

write_context_file() {
  local stable_revision="$1" stable_suffix="$2" candidate_revision="$3" candidate_suffix="$4"
  cat > "$RELEASE_CONTEXT" <<CTX
STABLE_REVISION=$stable_revision
STABLE_SUFFIX=$stable_suffix
CANDIDATE_REVISION=$candidate_revision
CANDIDATE_SUFFIX=$candidate_suffix
RELEASE_TAG=$TAG
CTX
  chmod 600 "$RELEASE_CONTEXT"
  add_local_exclude "files/$(basename "$RELEASE_CONTEXT")"
}

load_release_context() {
  [ -f "$RELEASE_CONTEXT" ] || { echo "BLOCKED: release context is missing: $RELEASE_CONTEXT" >&2; exit 1; }
  set -a; . "$RELEASE_CONTEXT"; set +a
  [ "${RELEASE_TAG:-}" = "$TAG" ] || { echo "BLOCKED: release context tag mismatch" >&2; exit 1; }
}

apim_health() {
  local args=(--fail --silent --show-error --max-time 20)
  if [ "$APIM_SUBSCRIPTION_REQUIRED" = "true" ]; then
    [ -n "${BEVOAC_APIM_SUBSCRIPTION_KEY:-}" ] || {
      echo "BLOCKED: BEVOAC_APIM_SUBSCRIPTION_KEY is required for APIM smoke tests" >&2
      return 1
    }
    args+=(-H "Ocp-Apim-Subscription-Key: $BEVOAC_APIM_SUBSCRIPTION_KEY")
  fi
  curl "${args[@]}" "$APIM_URL/v1/health" | jq -e '.status == "OK"' >/dev/null
}

preflight() {
  context; outputs
  local api_version worker_version
  api_version="$(python3 -c 'import json;print(json.load(open("bevoac-api-enterprise/package.json"))["version"])')"
  worker_version="$(python3 -c 'import json;print(json.load(open("bevoac-worker-enterprise/package.json"))["version"])')"
  [ "$api_version" = "6.1.3-production-ready" ] || { echo "BLOCKED: API version is $api_version" >&2; exit 1; }
  [ "$worker_version" = "6.1.3-production-ready" ] || { echo "BLOCKED: worker version is $worker_version" >&2; exit 1; }
  (cd "$IAC"; terraform fmt -check -recursive; terraform validate; bash scripts/static-hardening-check.sh)
  echo "release_tag=$TAG"
  echo "git_head=$(git rev-parse HEAD)"
  echo "PREFLIGHT_OK=true"
}

build() {
  context; outputs
  [ "${BEVOAC_APPROVE_IMAGE_PUSH:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_APPROVE_IMAGE_PUSH=YES is required" >&2; exit 1; }
  (cd "$API"; npm ci; npm run check; npm test)
  (cd "$WORKER"; npm ci; npm run check; npm test)
  az acr login --name "$ACR_NAME"
  docker buildx build --platform linux/amd64 --provenance=true --sbom=true \
    -t "$ACR_LOGIN_SERVER/bevoac-api-enterprise:$TAG" --push "$API"
  docker buildx build --platform linux/amd64 --provenance=true --sbom=true \
    -t "$ACR_LOGIN_SERVER/bevoac-worker-enterprise:$TAG" --push "$WORKER"
  az acr repository show --name "$ACR_NAME" --image "bevoac-api-enterprise:$TAG" --query '{digest:digest,created:createdTime}' -o json
  az acr repository show --name "$ACR_NAME" --image "bevoac-worker-enterprise:$TAG" --query '{digest:digest,created:createdTime}' -o json
  echo "BUILD_OK=true"
}

load_db_secrets() {
  PG_HOST="$POSTGRES_FQDN"; PG_PORT=5432; PG_DATABASE=postgres; PG_USER="$(terraform -chdir="$IAC" output -raw pg_admin_username 2>/dev/null || echo bevoacadmin)"
  PG_PASSWORD="$(kv_secret pg-password)"
  PG_SSL_MODE=verify-full
  PG_API_PASSWORD="$(kv_secret pg-api-password)"
  PG_WORKER_PASSWORD="$(kv_secret pg-worker-password)"
  PG_OUTBOX_PASSWORD="$(kv_secret pg-outbox-password)"
  PG_RETENTION_PASSWORD="$(kv_secret pg-retention-password)"
  PG_ADMIN_API_PASSWORD="$(kv_secret pg-admin-api-password)"
  PG_OPERATOR_PASSWORD="$(kv_secret pg-operator-password)"
  export PG_HOST PG_PORT PG_DATABASE PG_USER PG_PASSWORD PG_SSL_MODE
  export PG_API_PASSWORD PG_WORKER_PASSWORD PG_OUTBOX_PASSWORD
  export PG_RETENTION_PASSWORD PG_ADMIN_API_PASSWORD PG_OPERATOR_PASSWORD
}

clear_db_secrets() {
  unset PG_PASSWORD PG_API_PASSWORD PG_WORKER_PASSWORD PG_OUTBOX_PASSWORD
  unset PG_RETENTION_PASSWORD PG_ADMIN_API_PASSWORD PG_OPERATOR_PASSWORD
}

verify_db_boundary() { (cd "$API"; npm run check-db:runtime-boundary); }

migrate_db() {
  context; outputs
  [ "${BEVOAC_APPROVE_DB_MIGRATION:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_APPROVE_DB_MIGRATION=YES is required" >&2; exit 1; }
  load_db_secrets; trap clear_db_secrets EXIT
  (cd "$API"; ALLOW_RUNTIME_ROLE_SYNC=true npm run sync-db:runtime-roles; npm run migrate-db; ALLOW_SECURE_API_KEY_AUTH_APPLY=true npm run migrate-db:secure-api-key-auth; ALLOW_ENTERPRISE_RUNTIME_RLS_APPLY=true npm run migrate-db:runtime-role-rls; npm run check-db:runtime-boundary)
  echo "MIGRATION_OK=true"
}

plan_workloads() {
  context; outputs
  local stable_revision stable_suffix candidate_suffix candidate_revision
  stable_revision="$(stable_revision_name)"; [ -n "$stable_revision" ] || { echo "BLOCKED: no 100 percent stable API revision" >&2; exit 1; }
  stable_suffix="$(revision_suffix_from_name "$stable_revision")"
  candidate_suffix="$(sanitize_suffix "v613-$(date -u +%Y%m%d%H%M%S)")"
  candidate_revision="$API_APP--$candidate_suffix"
  write_release_vars workloads "$stable_suffix" "$candidate_suffix"
  terraform -chdir="$IAC" plan -out="$WORKLOAD_PLAN"
  terraform -chdir="$IAC" show -json "$WORKLOAD_PLAN" > "$WORKLOAD_PLAN.json"
  jq -e '[.resource_changes[]? | select(.change.actions | index("delete"))] | length == 0' "$WORKLOAD_PLAN.json" >/dev/null || {
    echo "BLOCKED: workload plan contains a deletion; review manually" >&2; exit 1;
  }
  write_context_file "$stable_revision" "$stable_suffix" "$candidate_revision" "$candidate_suffix"
  echo "WORKLOAD_PLAN_OK=true"
  echo "NEXT_REQUIRED_COMMAND=apply-workloads"
}

apply_workloads() {
  context; outputs; load_release_context
  [ "${BEVOAC_APPROVE_TERRAFORM_APPLY:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_APPROVE_TERRAFORM_APPLY=YES is required" >&2; exit 1; }
  [ -f "$WORKLOAD_PLAN" ] || { echo "BLOCKED: workload plan is missing" >&2; exit 1; }
  terraform -chdir="$IAC" apply "$WORKLOAD_PLAN"
  echo "WORKLOAD_APPLY_OK=true"
}

app_safe_json() { az containerapp show -g "$RESOURCE_GROUP" -n "$1" --query '{name:name,image:properties.template.containers[0].image,identity:identity.userAssignedIdentities,external:properties.configuration.ingress.external,env:properties.template.containers[0].env}' -o json; }
job_safe_json() { az containerapp job show -g "$RESOURCE_GROUP" -n "$1" --query '{name:name,image:properties.template.containers[0].image,identity:identity.userAssignedIdentities,env:properties.template.containers[0].env}' -o json; }

assert_app() {
  local app="$1" image="$2" identity="$3" pg="$4" mode="$5" secret="$6" sb="$7" ingress="${8:-any}" file="$FILES/smoke-$1.json"
  app_safe_json "$app" > "$file"
  jq -e --arg image "$image" --arg identity "$identity" --arg pg "$pg" --arg mode "$mode" --arg secret "$secret" --arg sb "$sb" --arg ingress "$ingress" '
    .image == $image and ((.identity // {} | keys | any(endswith("/" + $identity)))) and
    ([.env[]? | select(.name=="PG_USER") | .value][0] == $pg) and
    ([.env[]? | select(.name=="PG_PASSWORD") | .secretRef][0] == $secret) and
    (($mode == "") or ([.env[]? | select(.name=="APP_RUNTIME_MODE") | .value][0] == $mode)) and
    ([.env[]? | select(.name=="SERVICEBUS_CONNECTION_STRING")] | length == 0) and
    (($sb == "none" and ([.env[]? | select(.name|startswith("SERVICEBUS_"))] | length == 0)) or
     ($sb == "managed_identity" and ([.env[]? | select(.name=="SERVICEBUS_AUTH_MODE") | .value][0] == "managed_identity"))) and
    (($ingress == "any") or ($ingress == "internal" and .external == false) or ($ingress == "external" and .external == true))
  ' "$file" >/dev/null
}

assert_job() {
  local job="$1" image="$2" identity="$3" pg="$4" mode="$5" secret="$6" file="$FILES/smoke-$1.json"
  job_safe_json "$job" > "$file"
  jq -e --arg image "$image" --arg identity "$identity" --arg pg "$pg" --arg mode "$mode" --arg secret "$secret" '
    .image == $image and ((.identity // {} | keys | any(endswith("/" + $identity)))) and
    ([.env[]? | select(.name=="PG_USER") | .value][0] == $pg) and
    ([.env[]? | select(.name=="PG_PASSWORD") | .secretRef][0] == $secret) and
    ([.env[]? | select(.name=="APP_RUNTIME_MODE") | .value][0] == $mode)
  ' "$file" >/dev/null
}

revision_fqdn() {
  local revision="$1" fqdn environment_id default_domain
  fqdn="$(az containerapp revision show -g "$RESOURCE_GROUP" -n "$API_APP" --revision "$revision" --query properties.fqdn -o tsv 2>/dev/null || true)"
  if [ -z "$fqdn" ]; then
    environment_id="$(az containerapp show -g "$RESOURCE_GROUP" -n "$API_APP" --query properties.managedEnvironmentId -o tsv)"
    default_domain="$(az containerapp env show --ids "$environment_id" --query properties.defaultDomain -o tsv)"
    fqdn="$revision.$default_domain"
  fi
  printf '%s\n' "$fqdn"
}

candidate_health() {
  local fqdn; fqdn="$(revision_fqdn "$CANDIDATE_REVISION")"; [ -n "$fqdn" ] || return 1
  curl --fail --silent --show-error --max-time 20 "https://$fqdn/v1/health" | jq -e '.status == "OK"' >/dev/null
}

candidate_auth_smoke() {
  [ -n "${BEVOAC_TEST_API_KEY:-}" ] || { echo "BLOCKED: BEVOAC_TEST_API_KEY is required" >&2; return 1; }
  local fqdn; fqdn="$(revision_fqdn "$CANDIDATE_REVISION")"
  local invalid_code valid_code
  invalid_code="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 20 "https://$fqdn/v1/scans" -H "Authorization: Bearer invalid-v6-1-3-smoke-key" || true)"
  [ "$invalid_code" = "401" ] || { echo "BLOCKED: candidate invalid-key smoke returned HTTP $invalid_code" >&2; return 1; }
  valid_code="$(curl --silent --output "$FILES/candidate-scans.json" --write-out '%{http_code}' --max-time 20 "https://$fqdn/v1/scans?limit=1" -H "Authorization: Bearer $BEVOAC_TEST_API_KEY")"
  [ "$valid_code" = "200" ] || { echo "BLOCKED: candidate API-key smoke returned HTTP $valid_code" >&2; return 1; }
}

queue_health() {
  az servicebus queue show -g "$RESOURCE_GROUP" --namespace-name "$SB_NAMESPACE" -n "$SB_QUEUE" \
    --query '{active:countDetails.activeMessageCount,dlq:countDetails.deadLetterMessageCount,sessions:requiresSession}' -o json \
    | tee "$FILES/bevoac-v6-1-3-queue-smoke.json" | jq -e '.dlq == 0 and .sessions == true' >/dev/null
}

outbox_backlog_health() {
  local count
  count="$(load_db_secrets; trap clear_db_secrets EXIT; PGPASSWORD="$PG_PASSWORD" psql -X -v ON_ERROR_STOP=1 "host=$PG_HOST port=$PG_PORT dbname=$PG_DATABASE user=$PG_USER sslmode=$PG_SSL_MODE" -Atc "SELECT count(*) FROM public.outbox_events WHERE status IN ('PENDING','FAILED','PROCESSING') AND created_at < now() - interval '10 minutes';")"
  [ "$count" = "0" ] || { echo "BLOCKED: old or failed outbox backlog count is $count" >&2; return 1; }
}

smoke_workloads() {
  context; outputs; load_release_context
  local api_image="$ACR_LOGIN_SERVER/bevoac-api-enterprise:$TAG" worker_image="$ACR_LOGIN_SERVER/bevoac-worker-enterprise:$TAG"
  assert_app "$API_APP" "$api_image" "${API_APP/ca-/id-}" "bevoac_api" "public_api" "pg-api-password" "none" "external"
  assert_app "$WORKER_APP" "$worker_image" "${WORKER_APP/ca-/id-}" "bevoac_worker" "" "pg-worker-password" "managed_identity"
  assert_app "$OUTBOX_APP" "$api_image" "${OUTBOX_APP/ca-/id-}" "bevoac_outbox" "outbox" "pg-outbox-password" "managed_identity"
  assert_job "$RETENTION_JOB" "$api_image" "${RETENTION_JOB/job-/id-}" "bevoac_retention" "retention" "pg-retention-password"
  if [ -n "$ADMIN_API_APP" ] && [ "$ADMIN_API_APP" != "null" ]; then assert_app "$ADMIN_API_APP" "$api_image" "${ADMIN_API_APP/ca-/id-}" "bevoac_admin_api" "admin_api" "pg-admin-api-password" "none" "internal"; fi
  candidate_health; candidate_auth_smoke; apim_health; queue_health
  (load_db_secrets; trap clear_db_secrets EXIT; verify_db_boundary)
  outbox_backlog_health
  echo "WORKLOAD_SMOKE_OK=true"
}

release_health() { candidate_health; candidate_auth_smoke; apim_health; queue_health; outbox_backlog_health; }

rollback_traffic() {
  context; outputs; load_release_context
  az containerapp ingress traffic set -g "$RESOURCE_GROUP" -n "$API_APP" --revision-weight "$STABLE_REVISION=100" "$CANDIDATE_REVISION=0"
  echo "ROLLBACK_TRAFFIC_OK=true"
}

rollout() {
  context; outputs; load_release_context
  [ "${BEVOAC_APPROVE_TRAFFIC_ROLLOUT:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_APPROVE_TRAFFIC_ROLLOUT=YES is required" >&2; exit 1; }
  release_health
  for percentage in 5 25 100; do
    local stable_percentage=$((100 - percentage))
    az containerapp ingress traffic set -g "$RESOURCE_GROUP" -n "$API_APP" --revision-weight "$STABLE_REVISION=$stable_percentage" "$CANDIDATE_REVISION=$percentage"
    if ! release_health; then
      az containerapp ingress traffic set -g "$RESOURCE_GROUP" -n "$API_APP" --revision-weight "$STABLE_REVISION=100" "$CANDIDATE_REVISION=0"
      echo "ROLLBACK_TRAFFIC_OK=true" >&2; exit 1
    fi
    echo "traffic_candidate=$percentage"; sleep "$OBSERVE_SECONDS"
  done
  echo "ROLLOUT_OK=true"
  echo "NEXT_REQUIRED_COMMAND=plan-security"
}

plan_security() {
  context; outputs; load_release_context
  [ "${BEVOAC_PRIVATE_RUNNER_READY:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_PRIVATE_RUNNER_READY=YES is required" >&2; exit 1; }
  local current; current="$(stable_revision_name)"
  [ "$current" = "$CANDIDATE_REVISION" ] || { echo "BLOCKED: candidate does not own 100 percent traffic" >&2; exit 1; }
  write_release_vars security "$CANDIDATE_SUFFIX" "$CANDIDATE_SUFFIX"
  terraform -chdir="$IAC" plan -out="$SECURITY_PLAN"
  terraform -chdir="$IAC" show -json "$SECURITY_PLAN" > "$SECURITY_PLAN.json"
  local destructive
  destructive="$(jq -r '.resource_changes[]? | select(.change.actions | index("delete")) | .address' "$SECURITY_PLAN.json" | sort -u)"
  if [ -n "$destructive" ]; then
    local unexpected
    unexpected="$(printf '%s\n' "$destructive" | grep -Ev '^(azurerm_key_vault_secret\.servicebus_connection_string\[0\]|azurerm_postgresql_flexible_server_firewall_rule\.(admin_ip|container_apps_egress)\[0\]|azurerm_role_assignment\.(api_kv_reader|worker_kv_reader|api_sb_sender)\[0\]|time_sleep\.wait_for_workload_roles\[0\])$' || true)"
    [ -z "$unexpected" ] || { echo "BLOCKED: security plan has unapproved deletions:" >&2; printf '%s\n' "$unexpected" >&2; exit 1; }
  fi
  echo "SECURITY_PLAN_OK=true"
  echo "NEXT_REQUIRED_COMMAND=apply-security"
}

apply_security() {
  context; outputs; load_release_context
  [ "${BEVOAC_PRIVATE_RUNNER_READY:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_PRIVATE_RUNNER_READY=YES is required" >&2; exit 1; }
  [ "${BEVOAC_APPROVE_SECURITY_FINALIZE:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_APPROVE_SECURITY_FINALIZE=YES is required" >&2; exit 1; }
  [ -f "$SECURITY_PLAN" ] || { echo "BLOCKED: security plan is missing" >&2; exit 1; }
  terraform -chdir="$IAC" apply "$SECURITY_PLAN"
  write_context_file "$CANDIDATE_REVISION" "$CANDIDATE_SUFFIX" "$CANDIDATE_REVISION" "$CANDIDATE_SUFFIX"
  echo "SECURITY_APPLY_OK=true"
}

verify_legacy_rbac_removed() {
  local api_principal worker_principal kv_id sb_id
  api_principal="$(az identity show -g "$RESOURCE_GROUP" -n "${API_APP/ca-/id-}" --query principalId -o tsv)"
  worker_principal="$(az identity show -g "$RESOURCE_GROUP" -n "${WORKER_APP/ca-/id-}" --query principalId -o tsv)"
  kv_id="$(az keyvault show -g "$RESOURCE_GROUP" -n "$KEY_VAULT" --query id -o tsv)"
  sb_id="$(az servicebus namespace show -g "$RESOURCE_GROUP" -n "$SB_NAMESPACE" --query id -o tsv)"

  local api_kv worker_kv api_sender
  api_kv="$(az role assignment list --assignee-object-id "$api_principal" --scope "$kv_id" --all --query "[?scope=='$kv_id' && roleDefinitionName=='Key Vault Secrets User'] | length(@)" -o tsv)"
  worker_kv="$(az role assignment list --assignee-object-id "$worker_principal" --scope "$kv_id" --all --query "[?scope=='$kv_id' && roleDefinitionName=='Key Vault Secrets User'] | length(@)" -o tsv)"
  api_sender="$(az role assignment list --assignee-object-id "$api_principal" --scope "$sb_id" --all --query "[?scope=='$sb_id' && roleDefinitionName=='Azure Service Bus Data Sender'] | length(@)" -o tsv)"

  [ "$api_kv" = "0" ] || { echo "BLOCKED: API still has a vault-wide Key Vault Secrets User assignment" >&2; return 1; }
  [ "$worker_kv" = "0" ] || { echo "BLOCKED: worker still has a vault-wide Key Vault Secrets User assignment" >&2; return 1; }
  [ "$api_sender" = "0" ] || { echo "BLOCKED: public API still has Service Bus Sender" >&2; return 1; }
}

smoke_final() {
  context; outputs; load_release_context
  az keyvault show -g "$RESOURCE_GROUP" -n "$KEY_VAULT" --query '{publicNetworkAccess:properties.publicNetworkAccess,defaultAction:properties.networkAcls.defaultAction}' -o json | jq -e '.publicNetworkAccess == "Disabled" and .defaultAction == "Deny"' >/dev/null
  az postgres flexible-server show -g "$RESOURCE_GROUP" -n "${POSTGRES_FQDN%%.*}" --query '{publicNetworkAccess:network.publicNetworkAccess}' -o json | jq -e '.publicNetworkAccess == "Disabled"' >/dev/null
  az servicebus namespace show -g "$RESOURCE_GROUP" -n "$SB_NAMESPACE" --query '{sku:sku.name,publicNetworkAccess:publicNetworkAccess,disableLocalAuth:disableLocalAuth,minimumTlsVersion:minimumTlsVersion}' -o json \
    | tee "$FILES/bevoac-v6-1-3-servicebus-final.json" | jq -e '.sku == "Standard" and .publicNetworkAccess == "Enabled" and .disableLocalAuth == true and .minimumTlsVersion == "1.2"' >/dev/null
  if az keyvault secret show --vault-name "$KEY_VAULT" --name servicebus-connection-string --query id -o tsv >/dev/null 2>&1; then echo "BLOCKED: legacy Service Bus secret is still active" >&2; exit 1; fi
  verify_legacy_rbac_removed
  candidate_health; candidate_auth_smoke; apim_health; queue_health
  (load_db_secrets; trap clear_db_secrets EXIT; verify_db_boundary)
  outbox_backlog_health
  echo "FINAL_SECURITY_SMOKE_OK=true"
}

usage() {
  cat >&2 <<USAGE
Usage: $0 {preflight|build|migrate-db|plan-workloads|apply-workloads|smoke-workloads|rollout|rollback|plan-security|apply-security|smoke-final}
USAGE
}

case "${1:-}" in
  preflight) preflight ;;
  build) build ;;
  migrate-db) migrate_db ;;
  plan-workloads) plan_workloads ;;
  apply-workloads) apply_workloads ;;
  smoke-workloads) smoke_workloads ;;
  rollout) rollout ;;
  rollback) rollback_traffic ;;
  plan-security) plan_security ;;
  apply-security) apply_security ;;
  smoke-final) smoke_final ;;
  *) usage; exit 2 ;;
esac
