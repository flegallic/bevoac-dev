#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."

fail() { echo "[ERROR] $*" >&2; exit 1; }
pass() { echo "[OK] $*"; }
require_file() { [ -f "$1" ] || fail "Missing required file: $1"; }
require_fixed() { grep -Fq "$2" "$1" || fail "$3"; }

require_file "../scripts/release/deploy_v6_1_3.sh"
require_file "scripts/validate-release-plan.py"
require_file "tests/test_validate_release_plan.py"
require_file "release/v6.1.3-workload-migration.tfvars.example"
require_file "release/v6.1.3-security-finalize.tfvars.example"

if [[ -f outputs-hardening.tf ]]; then
  fail "outputs-hardening.tf must be removed; it can duplicate outputs already defined in outputs.tf."
fi
pass "No duplicate hardening outputs file is present."

grep -Eq 'aggregation[[:space:]]*=[[:space:]]*"Maximum"' monitor-alerts.tf || fail "Service Bus DLQ alert must use aggregation = Maximum."
pass "Service Bus DLQ alert aggregation is Maximum."

for marker in \
  'service_url           = "${local.api_public_base_url_effective}/v1"' \
  'resource "azurerm_api_management_api_operation"' \
  'url_template = "/*"' \
  'subscription_required = var.apim_subscription_required' \
  '<rate-limit calls="60" renewal-period="60"' \
  '<validate-content unspecified-content-type-action="ignore" max-size="1048576" size-exceeded-action="prevent"' \
  'X-Correlation-Id' \
  'X-Bevoac-Gateway' \
  'resource "azurerm_api_management_product" "bevoac"' \
  'resource "azurerm_api_management_product_policy" "bevoac"' \
  '<quota calls="5000" renewal-period="86400"'; do
  grep -Fq "$marker" api-gateway-apim.tf || fail "APIM hardening marker is missing: $marker"
done
pass "APIM gateway hardening policies are declared."

require_file "v620-apim-backend-boundary.tf"
require_file "v620-controlled-production.tf"
require_file "monitoring-v620.tf"
require_file "release/v6.2.0-controlled-production.tfvars.example"
require_fixed v620-apim-backend-boundary.tf 'resource "random_password" "apim_backend_token"' "APIM backend boundary credential is missing."
require_fixed v620-apim-backend-boundary.tf 'value = random_password.apim_backend_token[0].result' "APIM named value must use the generated backend credential."
require_fixed container-apps.tf 'APIM_BACKEND_BOUNDARY_REQUIRED' "API runtime does not require the APIM backend boundary."
require_fixed container-apps.tf 'APIM_BACKEND_SHARED_SECRET' "API runtime does not receive the APIM backend credential."
require_fixed v620-controlled-production.tf 'release_security_profile == "controlled_production"' "Controlled production profile is missing."
require_fixed v620-controlled-production.tf '!var.service_bus_local_auth_enabled' "Controlled production must disable Service Bus local authentication."
require_fixed v620-controlled-production.tf 'var.key_vault_network_default_action == "Deny"' "Controlled production must use Key Vault default Deny."
require_fixed monitoring-v620.tf 'resource "azurerm_monitor_action_group" "operations"' "Terraform Action Group is missing."
require_fixed monitoring-v620.tf 'resource "azurerm_monitor_diagnostic_setting" "critical"' "Critical diagnostic settings are missing."
require_fixed monitoring-v620.tf 'resource "azurerm_monitor_activity_log_alert" "resource_group_delete"' "Activity Log deletion alert is missing."
require_fixed monitoring-v620.tf 'monitoring_notification_channel_configured = (' "Plan-time monitoring notification predicate is missing."
require_fixed monitoring-v620.tf 'var.enable_baseline_activity_alerts && local.monitoring_notification_channel_configured ? 1 : 0' "Activity Log alert counts must use the plan-time known notification predicate."
require_fixed monitor-alerts.tf 'local.monitoring_notification_channel_configured ? 1 : 0' "Metric alert counts must use the plan-time known notification predicate."
require_fixed outputs.tf 'value       = local.monitor_action_group_id_effective' "Monitoring output must expose the effective Action Group ID."
if grep -Eq 'count[[:space:]]*=.*local\.monitor_action_group_id_effective[[:space:]]*!=[[:space:]]*""' monitoring-v620.tf monitor-alerts.tf; then
  fail "Monitoring resource counts must not depend on the apply-time Action Group ID."
fi
pass "Monitoring resource cardinality is plan-time stable and the effective Action Group ID is exported."
require_fixed release/v6.2.0-controlled-production.tfvars.example 'release_security_profile = "controlled_production"' "V6.2 release profile is missing."
require_fixed variables.tf 'variable "onboarding_result_mode"' "Onboarding result mode variable is missing."
require_fixed variables.tf 'contains(["api", "legacy_static"], lower(trimspace(var.onboarding_result_mode)))' "Onboarding result mode validation is missing."
require_fixed locals.tf 'onboarding_result_mode_effective' "Onboarding result mode is not resolved independently from legacy storage lifecycle."
require_fixed v620-controlled-production.tf 'local.onboarding_result_mode_requested == "api"' "Controlled production must require an explicit credential-free API onboarding result mode."
grep -Eq 'onboarding_result_mode[[:space:]]*=[[:space:]]*"api"' release/v6.2.0-controlled-production.tfvars.example || fail "V6.2 release profile must select the API onboarding result page."
grep -Eq 'deploy_onboarding_frontend[[:space:]]*=[[:space:]]*false' release/v6.2.0-controlled-production.tfvars.example || fail "V6.2 release profile must keep the legacy static helper disabled by default."
require_fixed frontend/index.html.tftpl 'DEMO ONLY' "Legacy static onboarding page must be explicitly classified as demo-only."
require_fixed frontend/index.html.tftpl 'ne collecte aucune clé API' "Legacy static onboarding page must not request a client credential."
if grep -Eq 'apiKey|fetch\(|sessionStorage|localStorage|authorization' frontend/index.html.tftpl; then
  fail "Legacy static onboarding page must not contain an active credential or API flow."
fi
if ! awk '
  /variable "deploy_onboarding_frontend"/ { in_block=1; next }
  in_block && /default[[:space:]]*=[[:space:]]*false/ { found=1 }
  in_block && /^}/ { exit(found ? 0 : 1) }
  END { if (!in_block) exit 1 }
' variables.tf; then
  fail "The legacy static onboarding frontend must default to disabled."
fi
pass "V6.2 controlled-production boundary, monitoring and demo-only frontend controls are declared."

for marker in \
  'output "service_bus_namespace_short"' \
  'output "service_bus_queue_name"' \
  'output "retention_job_name"' \
  'output "apim_gateway_url"' \
  'output "outbox_publisher_container_app_name"' \
  'output "admin_api_container_app_name"'; do
  grep -R -Fq "$marker" . || fail "Missing operational output: $marker"
done
pass "Operational outputs are present."

if grep -Fq 'trigger_type = "Schedule"' retention-job.tf; then
  fail "retention-job.tf must not use unsupported trigger_type."
fi
if grep -Eq 'env[[:space:]]*\{[[:space:]]*name[[:space:]]*=' retention-job.tf; then
  fail "retention-job.tf must not use single-line env blocks."
fi
require_fixed retention-job.tf 'azurerm_user_assigned_identity.retention.id' "Retention must use its dedicated identity."
require_fixed retention-job.tf 'value = "bevoac_retention"' "Retention must use bevoac_retention."
require_fixed retention-job.tf 'pg-retention-password' "Retention password reference is missing."
pass "Retention runtime is isolated."

require_fixed outbox-publisher.tf 'resource "azurerm_container_app" "outbox_publisher"' "Dedicated outbox publisher is missing."
require_fixed outbox-publisher.tf 'command = ["node", "scripts/outbox-publisher-daemon.js"]' "Outbox command is invalid."
require_fixed outbox-publisher.tf 'azurerm_user_assigned_identity.outbox.id' "Outbox must use its dedicated identity."
require_fixed outbox-publisher.tf 'value = "bevoac_outbox"' "Outbox must use bevoac_outbox."
pass "Dedicated outbox publisher is isolated."

require_fixed container-apps.tf 'APP_RUNTIME_MODE", value = "public_api"' "Public API runtime mode is missing."
require_fixed container-apps.tf 'value = "bevoac_api"' "Public API must use bevoac_api."
require_fixed container-apps.tf 'value = "bevoac_worker"' "Worker must use bevoac_worker."
require_fixed container-apps.tf 'custom_rule_type = "azure-servicebus"' "Worker Service Bus scale rule is missing."
grep -Eq 'identity_id[[:space:]]*=[[:space:]]*azurerm_user_assigned_identity.worker.id' container-apps.tf || fail "Worker scale rule must use Managed Identity."
pass "API and worker runtime identities are explicit."

require_fixed container-apps.tf 'api_candidate_revision_requested = (' "API candidate revision predicate is missing."
require_fixed container-apps.tf 'var.api_revision_suffix != var.api_stable_revision_suffix' "API candidate revision predicate must require a suffix distinct from stable."
require_fixed container-apps.tf 'for_each = var.api_stable_revision_suffix != "" && local.api_candidate_revision_requested ? [1] : []' "API candidate traffic must be emitted only for a distinct non-empty candidate."
require_fixed container-apps.tf 'revision_suffix = local.api_candidate_revision_requested ? var.api_revision_suffix : null' "API template revision suffix must be omitted in steady state."
pass "API revision creation and steady-state traffic semantics are explicit."

for file in container-apps.tf outbox-publisher.tf retention-job.tf; do
  require_fixed "$file" 'var.retain_legacy_containerapp_rollback_compatibility' "$file does not stage legacy Container Apps rollback compatibility."
done
require_fixed container-apps.tf 'servicebus-connection-string' "Worker legacy Service Bus secret transition is missing."
require_fixed outbox-publisher.tf 'azurerm_user_assigned_identity.api.id' "Outbox legacy API identity transition is missing."
require_fixed retention-job.tf 'azurerm_user_assigned_identity.api.id' "Retention legacy API identity transition is missing."
require_fixed release/v6.1.3-workload-migration.tfvars.example 'retain_legacy_containerapp_rollback_compatibility = true' "Workload profile must retain legacy Container Apps compatibility."
require_fixed release/v6.1.3-security-finalize.tfvars.example 'retain_legacy_containerapp_rollback_compatibility = false' "Security profile must remove legacy Container Apps compatibility."
pass "Container Apps rollback compatibility is explicitly staged."

grep -Eq 'public_network_access_enabled[[:space:]]*=[[:space:]]*var.key_vault_public_network_access_enabled' main.tf || fail "Key Vault public network state must be phase-controlled."
grep -Eq 'bypass[[:space:]]*=[[:space:]]*var.key_vault_network_bypass' main.tf || fail "Key Vault bypass must be phase-controlled."
grep -Eq 'default_action[[:space:]]*=[[:space:]]*var.key_vault_network_default_action' main.tf || fail "Key Vault default action must be phase-controlled."
grep -Eq 'ip_rules[[:space:]]*=[[:space:]]*local.key_vault_ip_rules_effective' main.tf || fail "Key Vault effective IP rules must be controlled."
grep -Eq 'virtual_network_subnet_ids[[:space:]]*=[[:space:]]*var.key_vault_virtual_network_subnet_ids' main.tf || fail "Key Vault VNet rules must be phase-controlled."
require_fixed variables-v6-1-3.tf 'variable "key_vault_public_network_access_enabled"' "Key Vault public network variable is missing."
require_fixed variables-v6-1-3.tf 'variable "key_vault_network_bypass"' "Key Vault bypass variable is missing."
require_fixed variables-v6-1-3.tf 'variable "key_vault_network_default_action"' "Key Vault default action variable is missing."
require_fixed release/v6.1.3-security-finalize.tfvars.example 'key_vault_network_default_action = "Deny"' "Security profile must use Key Vault default deny."
[[ ! -f zz-enterprise-v6-1-3.auto.tfvars ]] || fail "Tracked auto.tfvars must not force a production network transition."
pass "Key Vault network posture is snapshotted for workloads and explicitly finalized."

require_fixed workload-security-phase1.tf 'resource "azurerm_role_assignment" "api_legacy_admin_secret_reader"' "Legacy API admin-secret reader transition is missing."
require_fixed workload-security-phase1.tf 'resource "azurerm_role_assignment" "worker_servicebus_secret_reader"' "Legacy worker Service Bus reader transition is missing."
require_fixed legacy-rbac-transition-v6-1-3.tf 'to   = azurerm_role_assignment.api_legacy_admin_secret_reader[0]' "Legacy API reader state move is missing."
require_fixed legacy-rbac-transition-v6-1-3.tf 'to   = azurerm_role_assignment.worker_servicebus_secret_reader[0]' "Legacy worker reader state move is missing."
require_fixed release/v6.1.3-workload-migration.tfvars.example 'retain_legacy_api_admin_secret_reader = true' "Workload profile must retain legacy API admin-secret access."
require_fixed release/v6.1.3-security-finalize.tfvars.example 'retain_legacy_api_admin_secret_reader = false' "Security profile must remove legacy API admin-secret access."
pass "Legacy RBAC resources are staged and state-safe."

RUNNER="../scripts/release/deploy_v6_1_3.sh"
for marker in \
  'EXPECTED_API_DIGEST=' \
  'EXPECTED_WORKER_DIGEST=' \
  'API_IMAGE_REF="$ACR_LOGIN_SERVER/bevoac-api-enterprise@$API_DIGEST"' \
  'WORKER_IMAGE_REF="$ACR_LOGIN_SERVER/bevoac-worker-enterprise@$WORKER_DIGEST"' \
  'validate-release-plan.py" workloads' \
  'validate-release-plan.py" security' \
  'verify_plan_manifest workloads' \
  'verify_plan_manifest security' \
  'verify_workload_rollback_compatibility' \
  'retire-legacy-revisions' \
  'verify_retirement_marker' \
  'verify_security_applied_marker' \
  'verify_final_containerapp_cleanup' \
  'RELEASE_V6_1_3_DEPLOYMENT_COMPLETE=true'; do
  grep -Fq "$marker" "$RUNNER" || fail "Release runner safety marker is missing: $marker"
done
if grep -Eq 'api_image=.*bevoac-api-enterprise:\$TAG|assert_app .*bevoac-api-enterprise:\$TAG' "$RUNNER"; then
  fail "Release runner must not deploy mutable API image tags."
fi
if grep -Eq 'worker_image=.*bevoac-worker-enterprise:\$TAG|assert_app .*bevoac-worker-enterprise:\$TAG' "$RUNNER"; then
  fail "Release runner must not deploy mutable worker image tags."
fi
bash -n "$RUNNER" || fail "Release runner has a Bash syntax error."
pass "Release runner pins images, plans, rollout boundaries, and final smoke checks."

PY_CACHE_DIR="$(mktemp -d)"
trap 'rm -rf "$PY_CACHE_DIR"' EXIT
PYTHONPYCACHEPREFIX="$PY_CACHE_DIR" python3 -m py_compile scripts/validate-release-plan.py tests/test_validate_release_plan.py || fail "Release plan validator or tests do not compile."
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py' || fail "Release plan validator tests failed."
pass "Workload and security plan semantic gates pass their unit tests."

echo "Static IaC hardening checks passed."
