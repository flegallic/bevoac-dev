#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IAC="$ROOT/bevoac-iac-enterprise"
API="$ROOT/bevoac-api-enterprise"
WORKER="$ROOT/bevoac-worker-enterprise"
FILES="$ROOT/files"
TAG="${BEVOAC_RELEASE_TAG:-v6.1.3}"
EXPECTED_API_DIGEST="${BEVOAC_EXPECTED_API_DIGEST:-sha256:c9e9b334652b77f184f9ac8542736d0bf15137f9f04d260797d98fdc717e3f26}"
EXPECTED_WORKER_DIGEST="${BEVOAC_EXPECTED_WORKER_DIGEST:-sha256:e71d535f7af1a828eccfde688b939d4b77ffbb534c8bd879e82821ad9d6cd6fb}"
WORKLOAD_PLAN="${BEVOAC_WORKLOAD_PLAN_FILE:-$IAC/tfplan-v6-1-3-workloads}"
SECURITY_PLAN="${BEVOAC_SECURITY_PLAN_FILE:-$IAC/tfplan-v6-1-3-security}"
WORKLOAD_PLAN_MANIFEST="$WORKLOAD_PLAN.manifest.json"
SECURITY_PLAN_MANIFEST="$SECURITY_PLAN.manifest.json"
RELEASE_VARS="$IAC/zz-release-runtime.auto.tfvars.json"
RELEASE_CONTEXT="$FILES/bevoac-v6-1-3-release-context.env"
RETIREMENT_MARKER="$FILES/bevoac-v6-1-3-legacy-retirement.json"
SECURITY_APPLIED_MARKER="$FILES/bevoac-v6-1-3-security-applied.json"
OBSERVE_SECONDS="${BEVOAC_ROLLOUT_OBSERVE_SECONDS:-60}"
API_DIGEST=""
WORKER_DIGEST=""
API_IMAGE_REF=""
WORKER_IMAGE_REF=""
mkdir -p "$FILES"

need() { command -v "$1" >/dev/null 2>&1 || { echo "BLOCKED: required command not found: $1" >&2; exit 1; }; }

retry() {
  local attempts="$1" delay="$2" attempt=1
  shift 2
  while ! "$@"; do
    if [ "$attempt" -ge "$attempts" ]; then
      echo "BLOCKED: command failed after $attempts attempts: $*" >&2
      return 1
    fi
    echo "retry_attempt=$attempt command=$*" >&2
    attempt=$((attempt + 1))
    sleep "$delay"
  done
}

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

sha256_file() {
  python3 - "$1" <<'PY_SHA'
import hashlib, sys
from pathlib import Path
path = Path(sys.argv[1])
h = hashlib.sha256()
with path.open('rb') as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(chunk)
print(h.hexdigest())
PY_SHA
}

resolve_release_images() {
  API_DIGEST="$(az acr repository show --name "$ACR_NAME" --image "bevoac-api-enterprise:$TAG" --query digest -o tsv)"
  WORKER_DIGEST="$(az acr repository show --name "$ACR_NAME" --image "bevoac-worker-enterprise:$TAG" --query digest -o tsv)"
  [ "$API_DIGEST" = "$EXPECTED_API_DIGEST" ] || {
    echo "BLOCKED: API tag $TAG digest is $API_DIGEST, expected $EXPECTED_API_DIGEST" >&2
    exit 1
  }
  [ "$WORKER_DIGEST" = "$EXPECTED_WORKER_DIGEST" ] || {
    echo "BLOCKED: worker tag $TAG digest is $WORKER_DIGEST, expected $EXPECTED_WORKER_DIGEST" >&2
    exit 1
  }
  API_IMAGE_REF="$ACR_LOGIN_SERVER/bevoac-api-enterprise@$API_DIGEST"
  WORKER_IMAGE_REF="$ACR_LOGIN_SERVER/bevoac-worker-enterprise@$WORKER_DIGEST"
  export API_DIGEST WORKER_DIGEST API_IMAGE_REF WORKER_IMAGE_REF
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
  local kv_snapshot='{}'
  if [ "$phase" = "workloads" ]; then
    kv_snapshot="$(az keyvault show -g "$RESOURCE_GROUP" -n "$KEY_VAULT" --query '{publicNetworkAccess:properties.publicNetworkAccess,bypass:properties.networkAcls.bypass,defaultAction:properties.networkAcls.defaultAction,ipRules:properties.networkAcls.ipRules[].value,virtualNetworkSubnetIds:properties.networkAcls.virtualNetworkRules[].id}' -o json)"
  fi
  python3 - "$RELEASE_VARS" "$phase" "$API_IMAGE_REF" "$WORKER_IMAGE_REF" "$stable_suffix" "$candidate_suffix" "$kv_snapshot" <<'PY_VARS'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
phase, api_image, worker_image, stable, candidate, kv_snapshot_json = sys.argv[2:]
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
    snapshot = json.loads(kv_snapshot_json)
    public_state = snapshot.get('publicNetworkAccess')
    if public_state not in ('Enabled', 'Disabled'):
        raise SystemExit(f'unsupported Key Vault publicNetworkAccess value: {public_state!r}')
    bypass = snapshot.get('bypass') or 'None'
    default_action = snapshot.get('defaultAction')
    if bypass not in ('None', 'AzureServices'):
        raise SystemExit(f'unsupported Key Vault bypass value: {bypass!r}')
    if default_action not in ('Allow', 'Deny'):
        raise SystemExit(f'unsupported Key Vault defaultAction value: {default_action!r}')
    data.update({
        'service_bus_local_auth_enabled': True,
        'retain_legacy_servicebus_connection_secret': True,
        'retain_legacy_api_admin_secret_reader': True,
        'retain_legacy_containerapp_rollback_compatibility': True,
        'retain_legacy_broad_key_vault_roles': True,
        'retain_legacy_api_servicebus_sender': True,
        'key_vault_public_network_access_enabled': public_state == 'Enabled',
        'key_vault_network_bypass': bypass,
        'key_vault_network_default_action': default_action,
        'key_vault_ip_rules': sorted(set(snapshot.get('ipRules') or [])),
        'key_vault_virtual_network_subnet_ids': sorted(set(snapshot.get('virtualNetworkSubnetIds') or [])),
    })
elif phase == 'security':
    data.update({
        'enable_private_endpoints': True,
        'enable_postgres_public_access': False,
        'enable_db_admin_public_ip_rule': False,
        'service_bus_local_auth_enabled': False,
        'retain_legacy_servicebus_connection_secret': False,
        'retain_legacy_api_admin_secret_reader': False,
        'retain_legacy_containerapp_rollback_compatibility': False,
        'retain_legacy_broad_key_vault_roles': False,
        'retain_legacy_api_servicebus_sender': False,
        'key_vault_public_network_access_enabled': False,
        'key_vault_network_bypass': 'None',
        'key_vault_network_default_action': 'Deny',
        'key_vault_ip_rules': [],
        'key_vault_virtual_network_subnet_ids': [],
    })
else:
    raise SystemExit(f'unsupported release vars phase: {phase}')
path.write_text(json.dumps(data, indent=2, sort_keys=True) + '\n', encoding='utf-8')
path.chmod(0o600)
PY_VARS
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
RELEASE_GIT_HEAD=$(git -C "$ROOT" rev-parse HEAD)
API_DIGEST=$API_DIGEST
WORKER_DIGEST=$WORKER_DIGEST
API_IMAGE_REF=$API_IMAGE_REF
WORKER_IMAGE_REF=$WORKER_IMAGE_REF
CTX
  chmod 600 "$RELEASE_CONTEXT"
  add_local_exclude "files/$(basename "$RELEASE_CONTEXT")"
}

load_release_context() {
  [ -f "$RELEASE_CONTEXT" ] || { echo "BLOCKED: release context is missing: $RELEASE_CONTEXT" >&2; exit 1; }
  set -a; . "$RELEASE_CONTEXT"; set +a
  local context_api_digest="${API_DIGEST:-}"
  local context_worker_digest="${WORKER_DIGEST:-}"
  local context_api_image="${API_IMAGE_REF:-}"
  local context_worker_image="${WORKER_IMAGE_REF:-}"
  [ "${RELEASE_TAG:-}" = "$TAG" ] || { echo "BLOCKED: release context tag mismatch" >&2; exit 1; }
  [ "${RELEASE_GIT_HEAD:-}" = "$(git -C "$ROOT" rev-parse HEAD)" ] || { echo "BLOCKED: release context Git commit mismatch" >&2; exit 1; }
  resolve_release_images
  [ "$context_api_digest" = "$API_DIGEST" ] || { echo "BLOCKED: release context API digest mismatch" >&2; exit 1; }
  [ "$context_worker_digest" = "$WORKER_DIGEST" ] || { echo "BLOCKED: release context worker digest mismatch" >&2; exit 1; }
  [ "$context_api_image" = "$API_IMAGE_REF" ] || { echo "BLOCKED: release context API image mismatch" >&2; exit 1; }
  [ "$context_worker_image" = "$WORKER_IMAGE_REF" ] || { echo "BLOCKED: release context worker image mismatch" >&2; exit 1; }
}

plan_manifest_path() {
  case "$1" in
    workloads) printf '%s\n' "$WORKLOAD_PLAN_MANIFEST" ;;
    security) printf '%s\n' "$SECURITY_PLAN_MANIFEST" ;;
    *) echo "BLOCKED: unsupported manifest phase: $1" >&2; return 1 ;;
  esac
}

write_plan_manifest() {
  local phase="$1" plan="$2" manifest
  manifest="$(plan_manifest_path "$phase")"
  [ -f "$plan" ] && [ -f "$plan.json" ] && [ -f "$RELEASE_VARS" ] && [ -f "$RELEASE_CONTEXT" ] || {
    echo "BLOCKED: cannot write $phase plan manifest because an input is missing" >&2
    exit 1
  }
  python3 - "$manifest" "$phase" "$TAG" "$(git -C "$ROOT" rev-parse HEAD)" "$plan" "$plan.json" "$RELEASE_VARS" "$RELEASE_CONTEXT" "$API_IMAGE_REF" "$WORKER_IMAGE_REF" <<'PY_MANIFEST'
import hashlib, json, sys
from datetime import datetime, timezone
from pathlib import Path

def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

manifest, phase, tag, git_head, plan, plan_json, variables, context, api_image, worker_image = sys.argv[1:]
data = {
    'schema': 1,
    'phase': phase,
    'release_tag': tag,
    'git_head': git_head,
    'created_at_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'plan_path': str(Path(plan).resolve()),
    'plan_sha256': sha(plan),
    'plan_json_sha256': sha(plan_json),
    'release_vars_sha256': sha(variables),
    'release_context_sha256': sha(context),
    'api_image_ref': api_image,
    'worker_image_ref': worker_image,
}
Path(manifest).write_text(json.dumps(data, indent=2, sort_keys=True) + '\n', encoding='utf-8')
Path(manifest).chmod(0o600)
PY_MANIFEST
  add_local_exclude "bevoac-iac-enterprise/$(basename "$manifest")"
}

verify_plan_manifest() {
  local phase="$1" plan="$2" manifest
  manifest="$(plan_manifest_path "$phase")"
  [ -f "$manifest" ] || { echo "BLOCKED: $phase plan manifest is missing" >&2; exit 1; }
  python3 - "$manifest" "$phase" "$TAG" "$(git -C "$ROOT" rev-parse HEAD)" "$plan" "$plan.json" "$RELEASE_VARS" "$RELEASE_CONTEXT" "$API_IMAGE_REF" "$WORKER_IMAGE_REF" <<'PY_VERIFY'
import hashlib, json, sys
from pathlib import Path

def fail(message):
    raise SystemExit(f'BLOCKED: {message}')

def sha(path):
    p = Path(path)
    if not p.is_file():
        fail(f'missing file: {p}')
    h = hashlib.sha256()
    with p.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

manifest_path, phase, tag, git_head, plan, plan_json, variables, context, api_image, worker_image = sys.argv[1:]
data = json.loads(Path(manifest_path).read_text(encoding='utf-8'))
expected = {
    'phase': phase,
    'release_tag': tag,
    'git_head': git_head,
    'plan_path': str(Path(plan).resolve()),
    'plan_sha256': sha(plan),
    'plan_json_sha256': sha(plan_json),
    'release_vars_sha256': sha(variables),
    'release_context_sha256': sha(context),
    'api_image_ref': api_image,
    'worker_image_ref': worker_image,
}
for key, value in expected.items():
    if data.get(key) != value:
        fail(f'{phase} plan manifest mismatch for {key}: {data.get(key)!r} != {value!r}')
print(f'{phase.upper()}_PLAN_MANIFEST_OK=true')
PY_VERIFY
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
  context; outputs; resolve_release_images
  local api_version worker_version
  api_version="$(python3 -c 'import json;print(json.load(open("bevoac-api-enterprise/package.json"))["version"])')"
  worker_version="$(python3 -c 'import json;print(json.load(open("bevoac-worker-enterprise/package.json"))["version"])')"
  [ "$api_version" = "6.1.3-production-ready" ] || { echo "BLOCKED: API version is $api_version" >&2; exit 1; }
  [ "$worker_version" = "6.1.3-production-ready" ] || { echo "BLOCKED: worker version is $worker_version" >&2; exit 1; }
  (cd "$IAC"; terraform fmt -check -recursive; terraform validate; bash scripts/static-hardening-check.sh)
  echo "release_tag=$TAG"
  echo "git_head=$(git rev-parse HEAD)"
  echo "api_image_ref=$API_IMAGE_REF"
  echo "worker_image_ref=$WORKER_IMAGE_REF"
  echo "PREFLIGHT_OK=true"
}

build() {
  context; outputs; resolve_release_images
  echo "BUILD_SKIPPED=true"
  echo "BUILD_REASON=release_images_already_qualified_and_digest_pinned"
  echo "api_image_ref=$API_IMAGE_REF"
  echo "worker_image_ref=$WORKER_IMAGE_REF"
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
  load_db_secrets; trap clear_db_secrets EXIT
  if verify_db_boundary; then
    echo "MIGRATION_SKIPPED=true"
    echo "MIGRATION_REASON=database_boundary_already_verified"
    echo "MIGRATION_OK=true"
    return 0
  fi
  [ "${BEVOAC_APPROVE_DB_MIGRATION:-}" = "YES" ] || { echo "BLOCKED: database verification failed and BEVOAC_APPROVE_DB_MIGRATION=YES is required" >&2; exit 1; }
  (cd "$API"; ALLOW_RUNTIME_ROLE_SYNC=true npm run sync-db:runtime-roles; npm run migrate-db; ALLOW_SECURE_API_KEY_AUTH_APPLY=true npm run migrate-db:secure-api-key-auth; ALLOW_ENTERPRISE_RUNTIME_RLS_APPLY=true npm run migrate-db:runtime-role-rls; npm run check-db:runtime-boundary)
  echo "MIGRATION_OK=true"
}

plan_workloads() {
  context; outputs; resolve_release_images
  [ ! -f "$SECURITY_APPLIED_MARKER" ] || { echo "BLOCKED: V6.1.3 security finalization is already recorded" >&2; exit 1; }
  local stable_revision stable_suffix candidate_suffix candidate_revision
  stable_revision="$(stable_revision_name)"; [ -n "$stable_revision" ] || { echo "BLOCKED: no 100 percent stable API revision" >&2; exit 1; }
  stable_suffix="$(revision_suffix_from_name "$stable_revision")"
  candidate_suffix="$(sanitize_suffix "v613-$(date -u +%Y%m%d%H%M%S)")"
  candidate_revision="$API_APP--$candidate_suffix"
  rm -f "$WORKLOAD_PLAN" "$WORKLOAD_PLAN.json" "$WORKLOAD_PLAN_MANIFEST" \
    "$SECURITY_PLAN" "$SECURITY_PLAN.json" "$SECURITY_PLAN_MANIFEST" "$RETIREMENT_MARKER"
  write_release_vars workloads "$stable_suffix" "$candidate_suffix"
  terraform -chdir="$IAC" plan -out="$WORKLOAD_PLAN"
  terraform -chdir="$IAC" show -json "$WORKLOAD_PLAN" > "$WORKLOAD_PLAN.json"
  python3 "$IAC/scripts/validate-release-plan.py" workloads "$WORKLOAD_PLAN.json" "$RELEASE_VARS"
  write_context_file "$stable_revision" "$stable_suffix" "$candidate_revision" "$candidate_suffix"
  write_plan_manifest workloads "$WORKLOAD_PLAN"
  echo "WORKLOAD_PLAN_SHA256=$(sha256_file "$WORKLOAD_PLAN")"
  echo "WORKLOAD_PLAN_OK=true"
  echo "NEXT_REQUIRED_COMMAND=apply-workloads"
}

apply_workloads() {
  context; outputs; load_release_context
  [ "${BEVOAC_APPROVE_TERRAFORM_APPLY:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_APPROVE_TERRAFORM_APPLY=YES is required" >&2; exit 1; }
  verify_plan_manifest workloads "$WORKLOAD_PLAN"
  python3 "$IAC/scripts/validate-release-plan.py" workloads "$WORKLOAD_PLAN.json" "$RELEASE_VARS"
  terraform -chdir="$IAC" apply "$WORKLOAD_PLAN"
  echo "WORKLOAD_APPLY_OK=true"
  echo "NEXT_REQUIRED_COMMAND=smoke-workloads"
}

app_safe_json() { az containerapp show -g "$RESOURCE_GROUP" -n "$1" --query '{name:name,image:properties.template.containers[0].image,identity:identity.userAssignedIdentities,external:properties.configuration.ingress.external,env:properties.template.containers[0].env,secrets:properties.configuration.secrets[].{name:name,identity:identity}}' -o json; }
job_safe_json() { az containerapp job show -g "$RESOURCE_GROUP" -n "$1" --query '{name:name,image:properties.template.containers[0].image,identity:identity.userAssignedIdentities,env:properties.template.containers[0].env,secrets:properties.configuration.secrets[].{name:name,identity:identity}}' -o json; }

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

verify_live_key_vault_snapshot() {
  local live="$FILES/bevoac-v6-1-3-key-vault-network-live.json"
  az keyvault show -g "$RESOURCE_GROUP" -n "$KEY_VAULT" --query '{publicNetworkAccess:properties.publicNetworkAccess,bypass:properties.networkAcls.bypass,defaultAction:properties.networkAcls.defaultAction,ipRules:properties.networkAcls.ipRules[].value,virtualNetworkSubnetIds:properties.networkAcls.virtualNetworkRules[].id}' -o json > "$live"
  python3 - "$live" "$RELEASE_VARS" <<'PY_KV'
import json, sys
from pathlib import Path
live = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
vars_ = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
actual = {
    'public': live.get('publicNetworkAccess') == 'Enabled',
    'bypass': live.get('bypass') or 'None',
    'default': live.get('defaultAction'),
    'ips': sorted(set(live.get('ipRules') or [])),
    'vnets': sorted(set(live.get('virtualNetworkSubnetIds') or [])),
}
expected = {
    'public': vars_.get('key_vault_public_network_access_enabled'),
    'bypass': vars_.get('key_vault_network_bypass'),
    'default': vars_.get('key_vault_network_default_action'),
    'ips': sorted(set(vars_.get('key_vault_ip_rules') or [])),
    'vnets': sorted(set(vars_.get('key_vault_virtual_network_subnet_ids') or [])),
}
if actual != expected:
    raise SystemExit(f'BLOCKED: live Key Vault network posture differs from workload snapshot: actual={actual}, expected={expected}')
print('KEY_VAULT_NETWORK_SNAPSHOT_OK=true')
PY_KV
}

verify_workload_rollback_compatibility() {
  local api_file="$FILES/smoke-$API_APP.json"
  local worker_file="$FILES/smoke-$WORKER_APP.json"
  local outbox_file="$FILES/smoke-$OUTBOX_APP.json"
  local retention_file="$FILES/smoke-$RETENTION_JOB.json"
  local api_identity="${API_APP/ca-/id-}"
  local outbox_identity="${OUTBOX_APP/ca-/id-}"
  local retention_identity="${RETENTION_JOB/job-/id-}"

  jq -e '
    ([.secrets[]?.name] | sort) as $s
    | ($s | index("pg-password")) != null
    and ($s | index("admin-api-secret")) != null
    and ($s | index("pg-api-password")) != null
  ' "$api_file" >/dev/null || { echo "BLOCKED: public API rollback secrets are incomplete" >&2; return 1; }

  jq -e '
    ([.secrets[]?.name] | sort) as $s
    | ($s | index("pg-password")) != null
    and ($s | index("servicebus-connection-string")) != null
    and ($s | index("pg-worker-password")) != null
  ' "$worker_file" >/dev/null || { echo "BLOCKED: worker rollback secrets are incomplete" >&2; return 1; }

  jq -e --arg api "$api_identity" --arg dedicated "$outbox_identity" '
    ([.secrets[]?.name] | sort) as $s
    | (.identity // {} | keys) as $ids
    | ($s | index("pg-password")) != null
    and ($s | index("pg-outbox-password")) != null
    and ($ids | any(endswith("/" + $api)))
    and ($ids | any(endswith("/" + $dedicated)))
  ' "$outbox_file" >/dev/null || { echo "BLOCKED: outbox rollback identity or secrets are incomplete" >&2; return 1; }

  jq -e --arg api "$api_identity" --arg dedicated "$retention_identity" '
    ([.secrets[]?.name] | sort) as $s
    | (.identity // {} | keys) as $ids
    | ($s | index("pg-password")) != null
    and ($s | index("pg-retention-password")) != null
    and ($ids | any(endswith("/" + $api)))
    and ($ids | any(endswith("/" + $dedicated)))
  ' "$retention_file" >/dev/null || { echo "BLOCKED: retention rollback identity or secrets are incomplete" >&2; return 1; }

  az containerapp ingress traffic show -g "$RESOURCE_GROUP" -n "$API_APP" -o json     | jq -e --arg stable "$STABLE_REVISION" --arg candidate "$CANDIDATE_REVISION" '
        ([.[] | select(.revisionName == $stable and .weight == 100)] | length) == 1
        and ([.[] | select(.revisionName == $candidate and .weight == 0)] | length) == 1
      ' >/dev/null || { echo "BLOCKED: workload traffic is not stable=100/candidate=0" >&2; return 1; }

  [ "$(az containerapp revision show -g "$RESOURCE_GROUP" -n "$API_APP" --revision "$STABLE_REVISION" --query properties.active -o tsv)" = "true" ] || { echo "BLOCKED: stable API revision is not active" >&2; return 1; }
  [ "$(az containerapp revision show -g "$RESOURCE_GROUP" -n "$API_APP" --revision "$CANDIDATE_REVISION" --query properties.active -o tsv)" = "true" ] || { echo "BLOCKED: candidate API revision is not active" >&2; return 1; }
  [ "$(az servicebus namespace show -g "$RESOURCE_GROUP" -n "$SB_NAMESPACE" --query disableLocalAuth -o tsv)" = "false" ] || { echo "BLOCKED: Service Bus local auth was disabled during workload phase" >&2; return 1; }
  az keyvault secret show --vault-name "$KEY_VAULT" --name servicebus-connection-string --query id -o tsv >/dev/null
  verify_live_key_vault_snapshot
  echo "WORKLOAD_ROLLBACK_COMPATIBILITY_OK=true"
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

revision_health() {
  local revision="$1" fqdn
  fqdn="$(revision_fqdn "$revision")"; [ -n "$fqdn" ] || return 1
  curl --fail --silent --show-error --max-time 20 "https://$fqdn/v1/health" | jq -e '.status == "OK"' >/dev/null
}

candidate_health() { revision_health "$CANDIDATE_REVISION"; }

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
  assert_app "$API_APP" "$API_IMAGE_REF" "${API_APP/ca-/id-}" "bevoac_api" "public_api" "pg-api-password" "none" "external"
  assert_app "$WORKER_APP" "$WORKER_IMAGE_REF" "${WORKER_APP/ca-/id-}" "bevoac_worker" "" "pg-worker-password" "managed_identity"
  assert_app "$OUTBOX_APP" "$API_IMAGE_REF" "${OUTBOX_APP/ca-/id-}" "bevoac_outbox" "outbox" "pg-outbox-password" "managed_identity"
  assert_job "$RETENTION_JOB" "$API_IMAGE_REF" "${RETENTION_JOB/job-/id-}" "bevoac_retention" "retention" "pg-retention-password"
  if [ -n "$ADMIN_API_APP" ] && [ "$ADMIN_API_APP" != "null" ]; then
    assert_app "$ADMIN_API_APP" "$API_IMAGE_REF" "${ADMIN_API_APP/ca-/id-}" "bevoac_admin_api" "admin_api" "pg-admin-api-password" "none" "internal"
  fi
  verify_workload_rollback_compatibility
  candidate_health; candidate_auth_smoke; apim_health; queue_health
  (load_db_secrets; trap clear_db_secrets EXIT; verify_db_boundary)
  outbox_backlog_health
  echo "WORKLOAD_SMOKE_OK=true"
  echo "NEXT_REQUIRED_COMMAND=rollout"
}

release_health() {
  candidate_health || return 1
  candidate_auth_smoke || return 1
  apim_health || return 1
  queue_health || return 1
  outbox_backlog_health || return 1
}

active_revisions_json() {
  az containerapp revision list -g "$RESOURCE_GROUP" -n "$1" \
    --query '[?properties.active==`true`].{name:name,provisioningState:properties.provisioningState,healthState:properties.healthState,runningState:properties.runningState,image:properties.template.containers[0].image}' -o json
}

assert_single_active_revision() {
  local app="$1" expected_image="$2" file="$FILES/active-revisions-$1.json"
  active_revisions_json "$app" > "$file"
  jq -e --arg image "$expected_image" '
    length == 1
    and (.[0].provisioningState == "Provisioned" or .[0].provisioningState == "Succeeded")
    and ((.[0].healthState // "") != "Unhealthy")
    and .[0].image == $image
  ' "$file" >/dev/null || {
    echo "BLOCKED: $app does not have exactly one successful active revision with the expected immutable image" >&2
    return 1
  }
}

write_retirement_marker() {
  local active_api_file="$FILES/active-revisions-$API_APP.json"
  active_revisions_json "$API_APP" > "$active_api_file"
  python3 - "$RETIREMENT_MARKER" "$TAG" "$(git -C "$ROOT" rev-parse HEAD)" "$STABLE_REVISION" "$CANDIDATE_REVISION" "$API_IMAGE_REF" "$WORKER_IMAGE_REF" "$(sha256_file "$RELEASE_CONTEXT")" "$active_api_file" <<'PY_RETIRE'
import json, sys
from datetime import datetime, timezone
from pathlib import Path
marker, tag, git_head, stable, candidate, api_image, worker_image, context_sha, active_file = sys.argv[1:]
active = json.loads(Path(active_file).read_text(encoding='utf-8'))
data = {
    'schema': 1,
    'release_tag': tag,
    'git_head': git_head,
    'retired_stable_revision': stable,
    'promoted_candidate_revision': candidate,
    'api_image_ref': api_image,
    'worker_image_ref': worker_image,
    'release_context_sha256': context_sha,
    'active_api_revisions': active,
    'retired_at_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
}
Path(marker).write_text(json.dumps(data, indent=2, sort_keys=True) + '\n', encoding='utf-8')
Path(marker).chmod(0o600)
PY_RETIRE
  add_local_exclude "files/$(basename "$RETIREMENT_MARKER")"
}

verify_retirement_marker() {
  [ -f "$RETIREMENT_MARKER" ] || { echo "BLOCKED: legacy revision retirement marker is missing" >&2; return 1; }
  python3 - "$RETIREMENT_MARKER" "$TAG" "$(git -C "$ROOT" rev-parse HEAD)" "$STABLE_REVISION" "$CANDIDATE_REVISION" "$API_IMAGE_REF" "$WORKER_IMAGE_REF" "$(sha256_file "$RELEASE_CONTEXT")" <<'PY_VERIFY_RETIRE'
import json, sys
from pathlib import Path
path, tag, git_head, stable, candidate, api_image, worker_image, context_sha = sys.argv[1:]
data = json.loads(Path(path).read_text(encoding='utf-8'))
expected = {
    'release_tag': tag,
    'git_head': git_head,
    'retired_stable_revision': stable,
    'promoted_candidate_revision': candidate,
    'api_image_ref': api_image,
    'worker_image_ref': worker_image,
    'release_context_sha256': context_sha,
}
for key, value in expected.items():
    if data.get(key) != value:
        raise SystemExit(f'BLOCKED: legacy revision retirement marker mismatch for {key}')
print('LEGACY_REVISION_RETIREMENT_MARKER_OK=true')
PY_VERIFY_RETIRE

  az containerapp ingress traffic show -g "$RESOURCE_GROUP" -n "$API_APP" -o json \
    | jq -e --arg candidate "$CANDIDATE_REVISION" '
        ([.[] | select(.revisionName == $candidate and .weight == 100)] | length) == 1
        and ([.[] | select(.weight != 0 and .revisionName != $candidate)] | length) == 0
      ' >/dev/null || { echo "BLOCKED: candidate does not exclusively own 100 percent traffic" >&2; return 1; }

  local active_file="$FILES/active-revisions-$API_APP.json"
  active_revisions_json "$API_APP" > "$active_file"
  jq -e --arg candidate "$CANDIDATE_REVISION" --arg image "$API_IMAGE_REF" '
    length == 1
    and .[0].name == $candidate
    and (.[0].provisioningState == "Provisioned" or .[0].provisioningState == "Succeeded")
    and ((.[0].healthState // "") != "Unhealthy")
    and .[0].image == $image
  ' "$active_file" >/dev/null || { echo "BLOCKED: active API revision set is not limited to the promoted candidate" >&2; return 1; }

  local legacy_active
  legacy_active="$(az containerapp revision show -g "$RESOURCE_GROUP" -n "$API_APP" --revision "$STABLE_REVISION" --query properties.active -o tsv 2>/dev/null || echo false)"
  [ "$legacy_active" != "true" ] || { echo "BLOCKED: legacy stable API revision is still active" >&2; return 1; }
  assert_single_active_revision "$WORKER_APP" "$WORKER_IMAGE_REF"
  assert_single_active_revision "$OUTBOX_APP" "$API_IMAGE_REF"
  if [ -n "$ADMIN_API_APP" ] && [ "$ADMIN_API_APP" != "null" ]; then
    assert_single_active_revision "$ADMIN_API_APP" "$API_IMAGE_REF"
  fi
}

rollback_traffic() {
  context; outputs; load_release_context
  [ ! -f "$SECURITY_APPLIED_MARKER" ] || { echo "BLOCKED: rollback is not allowed after security finalization" >&2; exit 1; }
  [ "$STABLE_REVISION" != "$CANDIDATE_REVISION" ] || { echo "BLOCKED: no distinct legacy stable revision is available" >&2; exit 1; }

  local active
  active="$(az containerapp revision show -g "$RESOURCE_GROUP" -n "$API_APP" --revision "$STABLE_REVISION" --query properties.active -o tsv)"
  if [ "$active" != "true" ]; then
    az containerapp revision activate -g "$RESOURCE_GROUP" -n "$API_APP" --revision "$STABLE_REVISION"
  fi
  az containerapp ingress traffic set -g "$RESOURCE_GROUP" -n "$API_APP" \
    --revision-weight "$STABLE_REVISION=100" "$CANDIDATE_REVISION=0"
  az containerapp ingress traffic show -g "$RESOURCE_GROUP" -n "$API_APP" -o json \
    | jq -e --arg stable "$STABLE_REVISION" --arg candidate "$CANDIDATE_REVISION" '
        ([.[] | select(.revisionName == $stable and .weight == 100)] | length) == 1
        and ([.[] | select(.revisionName == $candidate and .weight == 0)] | length) == 1
      ' >/dev/null
  revision_health "$STABLE_REVISION"
  apim_health
  write_release_vars workloads "$STABLE_SUFFIX" "$CANDIDATE_SUFFIX"
  rm -f "$RETIREMENT_MARKER" "$SECURITY_PLAN" "$SECURITY_PLAN.json" "$SECURITY_PLAN_MANIFEST"
  echo "ROLLBACK_TRAFFIC_OK=true"
  echo "NEXT_REQUIRED_COMMAND=smoke-workloads"
}

rollout() {
  context; outputs; load_release_context
  [ ! -f "$SECURITY_APPLIED_MARKER" ] || { echo "BLOCKED: traffic rollout is not allowed after security finalization" >&2; exit 1; }
  [ "${BEVOAC_APPROVE_TRAFFIC_ROLLOUT:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_APPROVE_TRAFFIC_ROLLOUT=YES is required" >&2; exit 1; }
  rm -f "$RETIREMENT_MARKER" "$SECURITY_PLAN" "$SECURITY_PLAN.json" "$SECURITY_PLAN_MANIFEST"
  release_health
  for percentage in 5 25 100; do
    local stable_percentage=$((100 - percentage))
    az containerapp ingress traffic set -g "$RESOURCE_GROUP" -n "$API_APP" \
      --revision-weight "$STABLE_REVISION=$stable_percentage" "$CANDIDATE_REVISION=$percentage"
    if ! release_health; then
      az containerapp ingress traffic set -g "$RESOURCE_GROUP" -n "$API_APP" \
        --revision-weight "$STABLE_REVISION=100" "$CANDIDATE_REVISION=0"
      echo "ROLLBACK_TRAFFIC_OK=true" >&2
      exit 1
    fi
    echo "traffic_candidate=$percentage"
    sleep "$OBSERVE_SECONDS"
  done
  az containerapp ingress traffic show -g "$RESOURCE_GROUP" -n "$API_APP" -o json \
    | jq -e --arg candidate "$CANDIDATE_REVISION" '
        ([.[] | select(.revisionName == $candidate and .weight == 100)] | length) == 1
        and ([.[] | select(.weight != 0 and .revisionName != $candidate)] | length) == 0
      ' >/dev/null
  echo "ROLLOUT_OK=true"
  echo "NEXT_REQUIRED_COMMAND=retire-legacy-revisions"
}

retire_legacy_revisions() {
  context; outputs; load_release_context
  [ ! -f "$SECURITY_APPLIED_MARKER" ] || { echo "BLOCKED: legacy revision retirement is already past the security boundary" >&2; exit 1; }
  [ "${BEVOAC_APPROVE_LEGACY_REVISION_RETIREMENT:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_APPROVE_LEGACY_REVISION_RETIREMENT=YES is required" >&2; exit 1; }
  [ "$STABLE_REVISION" != "$CANDIDATE_REVISION" ] || { echo "BLOCKED: stable and candidate revisions are identical" >&2; exit 1; }
  release_health

  local current active_revisions revision
  current="$(stable_revision_name)"
  [ "$current" = "$CANDIDATE_REVISION" ] || { echo "BLOCKED: candidate does not own 100 percent traffic" >&2; exit 1; }
  active_revisions="$(az containerapp revision list -g "$RESOURCE_GROUP" -n "$API_APP" --query '[?properties.active==`true`].name' -o tsv)"
  while IFS= read -r revision; do
    [ -n "$revision" ] || continue
    if [ "$revision" != "$CANDIDATE_REVISION" ]; then
      az containerapp revision deactivate -g "$RESOURCE_GROUP" -n "$API_APP" --revision "$revision"
    fi
  done <<EOF_ACTIVE
$active_revisions
EOF_ACTIVE

  assert_single_active_revision "$WORKER_APP" "$WORKER_IMAGE_REF"
  assert_single_active_revision "$OUTBOX_APP" "$API_IMAGE_REF"
  if [ -n "$ADMIN_API_APP" ] && [ "$ADMIN_API_APP" != "null" ]; then
    assert_single_active_revision "$ADMIN_API_APP" "$API_IMAGE_REF"
  fi
  candidate_health; candidate_auth_smoke; apim_health
  write_retirement_marker
  verify_retirement_marker
  echo "LEGACY_REVISION_RETIREMENT_OK=true"
  echo "NEXT_REQUIRED_COMMAND=plan-security"
}

plan_security() {
  context; outputs; load_release_context
  [ ! -f "$SECURITY_APPLIED_MARKER" ] || { echo "BLOCKED: security finalization is already recorded" >&2; exit 1; }
  [ "${BEVOAC_PRIVATE_RUNNER_READY:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_PRIVATE_RUNNER_READY=YES is required" >&2; exit 1; }
  verify_retirement_marker
  rm -f "$SECURITY_PLAN" "$SECURITY_PLAN.json" "$SECURITY_PLAN_MANIFEST"
  write_release_vars security "$CANDIDATE_SUFFIX" "$CANDIDATE_SUFFIX"
  terraform -chdir="$IAC" plan -out="$SECURITY_PLAN"
  terraform -chdir="$IAC" show -json "$SECURITY_PLAN" > "$SECURITY_PLAN.json"
  python3 "$IAC/scripts/validate-release-plan.py" security "$SECURITY_PLAN.json" "$RELEASE_VARS"
  write_plan_manifest security "$SECURITY_PLAN"
  echo "SECURITY_PLAN_SHA256=$(sha256_file "$SECURITY_PLAN")"
  echo "SECURITY_PLAN_OK=true"
  echo "NEXT_REQUIRED_COMMAND=apply-security"
}

write_security_applied_marker() {
  local retired_stable="$1"
  python3 - "$SECURITY_APPLIED_MARKER" "$TAG" "$(git -C "$ROOT" rev-parse HEAD)" "$retired_stable" "$CANDIDATE_REVISION" "$API_IMAGE_REF" "$WORKER_IMAGE_REF" "$(sha256_file "$RELEASE_CONTEXT")" "$(sha256_file "$SECURITY_PLAN")" <<'PY_SECURITY_MARKER'
import json, sys
from datetime import datetime, timezone
from pathlib import Path
path, tag, git_head, retired, candidate, api_image, worker_image, context_sha, plan_sha = sys.argv[1:]
data = {
    'schema': 1,
    'release_tag': tag,
    'git_head': git_head,
    'retired_stable_revision': retired,
    'promoted_candidate_revision': candidate,
    'api_image_ref': api_image,
    'worker_image_ref': worker_image,
    'release_context_sha256': context_sha,
    'security_plan_sha256': plan_sha,
    'applied_at_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
}
Path(path).write_text(json.dumps(data, indent=2, sort_keys=True) + '\n', encoding='utf-8')
Path(path).chmod(0o600)
PY_SECURITY_MARKER
  add_local_exclude "files/$(basename "$SECURITY_APPLIED_MARKER")"
}

verify_security_applied_marker() {
  [ -f "$SECURITY_APPLIED_MARKER" ] || { echo "BLOCKED: security applied marker is missing" >&2; return 1; }
  RETIRED_STABLE_REVISION="$(jq -r '.retired_stable_revision // empty' "$SECURITY_APPLIED_MARKER")"
  export RETIRED_STABLE_REVISION
  python3 - "$SECURITY_APPLIED_MARKER" "$TAG" "$(git -C "$ROOT" rev-parse HEAD)" "$CANDIDATE_REVISION" "$API_IMAGE_REF" "$WORKER_IMAGE_REF" "$(sha256_file "$RELEASE_CONTEXT")" <<'PY_VERIFY_SECURITY'
import json, sys
from pathlib import Path
path, tag, git_head, candidate, api_image, worker_image, context_sha = sys.argv[1:]
data = json.loads(Path(path).read_text(encoding='utf-8'))
expected = {
    'release_tag': tag,
    'git_head': git_head,
    'promoted_candidate_revision': candidate,
    'api_image_ref': api_image,
    'worker_image_ref': worker_image,
    'release_context_sha256': context_sha,
}
for key, value in expected.items():
    if data.get(key) != value:
        raise SystemExit(f'BLOCKED: security applied marker mismatch for {key}')
if not data.get('retired_stable_revision'):
    raise SystemExit('BLOCKED: security applied marker has no retired stable revision')
print('SECURITY_APPLIED_MARKER_OK=true')
PY_VERIFY_SECURITY
}

apply_security() {
  context; outputs; load_release_context
  [ "${BEVOAC_PRIVATE_RUNNER_READY:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_PRIVATE_RUNNER_READY=YES is required" >&2; exit 1; }
  [ "${BEVOAC_APPROVE_SECURITY_FINALIZE:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_APPROVE_SECURITY_FINALIZE=YES is required" >&2; exit 1; }
  verify_retirement_marker
  verify_plan_manifest security "$SECURITY_PLAN"
  python3 "$IAC/scripts/validate-release-plan.py" security "$SECURITY_PLAN.json" "$RELEASE_VARS"
  release_health
  local retired_stable="$STABLE_REVISION"
  terraform -chdir="$IAC" apply "$SECURITY_PLAN"
  write_context_file "$CANDIDATE_REVISION" "$CANDIDATE_SUFFIX" "$CANDIDATE_REVISION" "$CANDIDATE_SUFFIX"
  write_security_applied_marker "$retired_stable"
  echo "SECURITY_APPLY_OK=true"
  echo "NEXT_REQUIRED_COMMAND=smoke-final"
}

verify_legacy_rbac_removed() {
  local api_principal worker_principal kv_id sb_id
  api_principal="$(az identity show -g "$RESOURCE_GROUP" -n "${API_APP/ca-/id-}" --query principalId -o tsv)" || return 1
  worker_principal="$(az identity show -g "$RESOURCE_GROUP" -n "${WORKER_APP/ca-/id-}" --query principalId -o tsv)" || return 1
  kv_id="$(az keyvault show -g "$RESOURCE_GROUP" -n "$KEY_VAULT" --query id -o tsv)" || return 1
  sb_id="$(az servicebus namespace show -g "$RESOURCE_GROUP" -n "$SB_NAMESPACE" --query id -o tsv)" || return 1

  local api_kv worker_kv api_sender api_admin_secret worker_servicebus_secret
  api_kv="$(az role assignment list --assignee-object-id "$api_principal" --scope "$kv_id" --all --query "[?scope=='$kv_id' && roleDefinitionName=='Key Vault Secrets User'] | length(@)" -o tsv)" || return 1
  worker_kv="$(az role assignment list --assignee-object-id "$worker_principal" --scope "$kv_id" --all --query "[?scope=='$kv_id' && roleDefinitionName=='Key Vault Secrets User'] | length(@)" -o tsv)" || return 1
  api_admin_secret="$(az role assignment list --assignee-object-id "$api_principal" --all --query "[?scope=='$kv_id/secrets/admin-api-secret' && roleDefinitionName=='Key Vault Secrets User'] | length(@)" -o tsv)" || return 1
  worker_servicebus_secret="$(az role assignment list --assignee-object-id "$worker_principal" --all --query "[?scope=='$kv_id/secrets/servicebus-connection-string' && roleDefinitionName=='Key Vault Secrets User'] | length(@)" -o tsv)" || return 1
  api_sender="$(az role assignment list --assignee-object-id "$api_principal" --scope "$sb_id" --all --query "[?scope=='$sb_id' && roleDefinitionName=='Azure Service Bus Data Sender'] | length(@)" -o tsv)" || return 1

  [ "$api_kv" = "0" ] || { echo "BLOCKED: API still has a vault-wide Key Vault Secrets User assignment" >&2; return 1; }
  [ "$worker_kv" = "0" ] || { echo "BLOCKED: worker still has a vault-wide Key Vault Secrets User assignment" >&2; return 1; }
  [ "$api_admin_secret" = "0" ] || { echo "BLOCKED: public API still reads admin-api-secret" >&2; return 1; }
  [ "$worker_servicebus_secret" = "0" ] || { echo "BLOCKED: worker still reads the legacy Service Bus connection secret" >&2; return 1; }
  [ "$api_sender" = "0" ] || { echo "BLOCKED: public API still has Service Bus Sender" >&2; return 1; }
}

verify_final_containerapp_cleanup() {
  assert_app "$API_APP" "$API_IMAGE_REF" "${API_APP/ca-/id-}" "bevoac_api" "public_api" "pg-api-password" "none" "external" || return 1
  assert_app "$WORKER_APP" "$WORKER_IMAGE_REF" "${WORKER_APP/ca-/id-}" "bevoac_worker" "" "pg-worker-password" "managed_identity" || return 1
  assert_app "$OUTBOX_APP" "$API_IMAGE_REF" "${OUTBOX_APP/ca-/id-}" "bevoac_outbox" "outbox" "pg-outbox-password" "managed_identity" || return 1
  assert_job "$RETENTION_JOB" "$API_IMAGE_REF" "${RETENTION_JOB/job-/id-}" "bevoac_retention" "retention" "pg-retention-password" || return 1
  if [ -n "$ADMIN_API_APP" ] && [ "$ADMIN_API_APP" != "null" ]; then
    assert_app "$ADMIN_API_APP" "$API_IMAGE_REF" "${ADMIN_API_APP/ca-/id-}" "bevoac_admin_api" "admin_api" "pg-admin-api-password" "none" "internal" || return 1
  fi

  local api_identity="${API_APP/ca-/id-}"
  local worker_identity="${WORKER_APP/ca-/id-}"
  local outbox_identity="${OUTBOX_APP/ca-/id-}"
  local retention_identity="${RETENTION_JOB/job-/id-}"

  jq -e --arg identity "$api_identity" '
    ([.secrets[]?.name] | sort) == ["microsoft-client-secret","onboarding-state-secret","pg-api-password"]
    and ((.identity // {} | keys) | length) == 1
    and ((.identity // {} | keys) | any(endswith("/" + $identity)))
  ' "$FILES/smoke-$API_APP.json" >/dev/null || { echo "BLOCKED: final public API secrets or identities are not isolated" >&2; return 1; }

  jq -e --arg identity "$worker_identity" '
    ([.secrets[]?.name] | sort) == ["microsoft-client-secret","pg-worker-password"]
    and ((.identity // {} | keys) | length) == 1
    and ((.identity // {} | keys) | any(endswith("/" + $identity)))
  ' "$FILES/smoke-$WORKER_APP.json" >/dev/null || { echo "BLOCKED: final worker secrets or identities are not isolated" >&2; return 1; }

  jq -e --arg identity "$outbox_identity" '
    ([.secrets[]?.name] | sort) == ["pg-outbox-password"]
    and ((.identity // {} | keys) | length) == 1
    and ((.identity // {} | keys) | any(endswith("/" + $identity)))
  ' "$FILES/smoke-$OUTBOX_APP.json" >/dev/null || { echo "BLOCKED: final outbox secrets or identities are not isolated" >&2; return 1; }

  jq -e --arg identity "$retention_identity" '
    ([.secrets[]?.name] | sort) == ["pg-retention-password"]
    and ((.identity // {} | keys) | length) == 1
    and ((.identity // {} | keys) | any(endswith("/" + $identity)))
  ' "$FILES/smoke-$RETENTION_JOB.json" >/dev/null || { echo "BLOCKED: final retention secrets or identities are not isolated" >&2; return 1; }

  if [ -n "$ADMIN_API_APP" ] && [ "$ADMIN_API_APP" != "null" ]; then
    jq -e '
      ([.secrets[]?.name] | sort) == ["pg-admin-api-password"]
      and ((.identity // {} | keys) | length) == 1
    ' "$FILES/smoke-$ADMIN_API_APP.json" >/dev/null || { echo "BLOCKED: final admin API secrets or identities are not isolated" >&2; return 1; }
  fi

  az containerapp ingress traffic show -g "$RESOURCE_GROUP" -n "$API_APP" -o json \
    | jq -e --arg candidate "$CANDIDATE_REVISION" '
        length == 1
        and .[0].revisionName == $candidate
        and .[0].weight == 100
      ' >/dev/null || { echo "BLOCKED: final API traffic is not exclusively assigned to the candidate" >&2; return 1; }

  local active_file="$FILES/active-revisions-$API_APP.json"
  active_revisions_json "$API_APP" > "$active_file"
  jq -e --arg candidate "$CANDIDATE_REVISION" --arg image "$API_IMAGE_REF" '
    length == 1
    and .[0].name == $candidate
    and (.[0].provisioningState == "Provisioned" or .[0].provisioningState == "Succeeded")
    and ((.[0].healthState // "") != "Unhealthy")
    and .[0].image == $image
  ' "$active_file" >/dev/null || { echo "BLOCKED: final API active revision set is invalid" >&2; return 1; }

  assert_single_active_revision "$WORKER_APP" "$WORKER_IMAGE_REF" || return 1
  assert_single_active_revision "$OUTBOX_APP" "$API_IMAGE_REF" || return 1
  if [ -n "$ADMIN_API_APP" ] && [ "$ADMIN_API_APP" != "null" ]; then
    assert_single_active_revision "$ADMIN_API_APP" "$API_IMAGE_REF" || return 1
  fi

  local retired_active
  retired_active="$(az containerapp revision show -g "$RESOURCE_GROUP" -n "$API_APP" --revision "$RETIRED_STABLE_REVISION" --query properties.active -o tsv 2>/dev/null || echo false)"
  [ "$retired_active" != "true" ] || { echo "BLOCKED: retired API revision became active again" >&2; return 1; }
  echo "FINAL_CONTAINERAPP_CLEANUP_OK=true"
}

verify_final_network_posture() {
  az keyvault show -g "$RESOURCE_GROUP" -n "$KEY_VAULT" \
    --query '{publicNetworkAccess:properties.publicNetworkAccess,bypass:properties.networkAcls.bypass,defaultAction:properties.networkAcls.defaultAction,ipRules:properties.networkAcls.ipRules,vnetRules:properties.networkAcls.virtualNetworkRules}' -o json \
    | tee "$FILES/bevoac-v6-1-3-key-vault-final.json" \
    | jq -e '.publicNetworkAccess == "Disabled" and .bypass == "None" and .defaultAction == "Deny" and ((.ipRules // []) | length) == 0 and ((.vnetRules // []) | length) == 0' >/dev/null || return 1

  az postgres flexible-server show -g "$RESOURCE_GROUP" -n "${POSTGRES_FQDN%%.*}" \
    --query '{publicNetworkAccess:network.publicNetworkAccess}' -o json \
    | tee "$FILES/bevoac-v6-1-3-postgres-final.json" \
    | jq -e '.publicNetworkAccess == "Disabled"' >/dev/null || return 1

  az servicebus namespace show -g "$RESOURCE_GROUP" -n "$SB_NAMESPACE" \
    --query '{sku:sku.name,publicNetworkAccess:publicNetworkAccess,disableLocalAuth:disableLocalAuth,minimumTlsVersion:minimumTlsVersion}' -o json \
    | tee "$FILES/bevoac-v6-1-3-servicebus-final.json" \
    | jq -e '.sku == "Standard" and .publicNetworkAccess == "Enabled" and .disableLocalAuth == true and .minimumTlsVersion == "1.2"' >/dev/null || return 1
  echo "FINAL_NETWORK_POSTURE_OK=true"
}

verify_legacy_servicebus_secret_removed() {
  local output status
  set +e
  output="$(az keyvault secret show --vault-name "$KEY_VAULT" --name servicebus-connection-string --query id -o tsv 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "BLOCKED: legacy Service Bus secret is still active" >&2
    return 1
  fi
  if printf '%s' "$output" | grep -Eqi 'SecretNotFound|secret[^[:cntrl:]]*not found|secret[^[:cntrl:]]*does not exist'; then
    echo "LEGACY_SERVICEBUS_SECRET_REMOVED=true"
    return 0
  fi
  echo "BLOCKED: cannot verify legacy Service Bus secret removal: $output" >&2
  return 1
}

smoke_final() {
  context; outputs; load_release_context
  [ "${BEVOAC_PRIVATE_RUNNER_READY:-}" = "YES" ] || { echo "BLOCKED: BEVOAC_PRIVATE_RUNNER_READY=YES is required" >&2; exit 1; }
  verify_security_applied_marker
  retry 12 10 verify_final_network_posture
  retry 12 10 verify_final_containerapp_cleanup
  retry 18 10 verify_legacy_servicebus_secret_removed
  retry 18 10 verify_legacy_rbac_removed
  candidate_health; candidate_auth_smoke; apim_health; queue_health
  (load_db_secrets; trap clear_db_secrets EXIT; verify_db_boundary)
  outbox_backlog_health
  echo "FINAL_SECURITY_SMOKE_OK=true"
  echo "RELEASE_V6_1_3_DEPLOYMENT_COMPLETE=true"
}

usage() {
  cat >&2 <<USAGE
Usage: $0 {preflight|build|migrate-db|plan-workloads|apply-workloads|smoke-workloads|rollout|rollback|retire-legacy-revisions|plan-security|apply-security|smoke-final}
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
  retire-legacy-revisions) retire_legacy_revisions ;;
  plan-security) plan_security ;;
  apply-security) apply_security ;;
  smoke-final) smoke_final ;;
  *) usage; exit 2 ;;
esac
