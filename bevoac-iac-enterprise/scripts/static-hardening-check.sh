#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

fail() { echo "[ERROR] $*" >&2; exit 1; }
pass() { echo "[OK] $*"; }

if [[ -f outputs-hardening.tf ]]; then
  fail "outputs-hardening.tf must be removed; it can duplicate outputs already defined in outputs.tf."
fi
pass "No duplicate hardening outputs file is present."

grep -q 'aggregation *= *"Maximum"' monitor-alerts.tf || fail "Service Bus DLQ alert must use aggregation = Maximum."
pass "Service Bus DLQ alert aggregation is Maximum."

grep -q 'service_url *= *"${local.api_public_base_url_effective}/v1"' api-gateway-apim.tf || fail "APIM backend service_url must point to /v1."
grep -q 'azurerm_api_management_api_operation' api-gateway-apim.tf || fail "APIM proxy operations are missing."
grep -q 'url_template *= *"/\*"' api-gateway-apim.tf || fail "APIM proxy operation url_template must be /*."
grep -q 'subscription_required *= *true' api-gateway-apim.tf || fail "APIM subscription_required must be mandatory."
grep -q '<rate-limit calls="60" renewal-period="60"' api-gateway-apim.tf || fail "APIM rate limit is missing."
grep -q '<validate-content unspecified-content-type-action="ignore" max-size="1048576" size-exceeded-action="prevent"' api-gateway-apim.tf || fail "APIM request size protection is missing."
grep -q 'X-Correlation-Id' api-gateway-apim.tf || fail "APIM must set X-Correlation-Id."
grep -q 'X-Bevoac-Gateway' api-gateway-apim.tf || fail "APIM must set X-Bevoac-Gateway."
grep -q 'resource "azurerm_api_management_product" "bevoac"' api-gateway-apim.tf || fail "APIM product is missing."
grep -q 'resource "azurerm_api_management_product_policy" "bevoac"' api-gateway-apim.tf || fail "APIM product quota policy is missing."
grep -q '<quota calls="5000" renewal-period="86400"' api-gateway-apim.tf || fail "APIM product quota is missing."
pass "APIM gateway hardening policies are declared."

for marker in \
  'output "service_bus_namespace_short"' \
  'output "service_bus_queue_name"' \
  'output "retention_job_name"' \
  'output "apim_gateway_url"'; do
  grep -R -q "$marker" . || fail "Missing operational output: $marker"
done
grep -R -q 'output "outbox_publisher_container_app_name"' . || fail "Missing outbox output."
grep -R -q 'output "admin_api_container_app_name"' . || fail "Missing admin API output."
pass "Operational outputs are present."

if grep -q 'trigger_type *= *"Schedule"' retention-job.tf; then
  fail "retention-job.tf must not use unsupported trigger_type."
fi
if grep -q 'env { name =' retention-job.tf; then
  fail "retention-job.tf must not use single-line env blocks."
fi
grep -q 'user_assigned_identity.retention.id' retention-job.tf || fail "Retention must use its dedicated identity."
grep -q 'value = "bevoac_retention"' retention-job.tf || fail "Retention must use bevoac_retention."
grep -q 'pg-retention-password' retention-job.tf || fail "Retention password reference is missing."
pass "Retention runtime is isolated."

grep -q 'resource "azurerm_container_app" "outbox_publisher"' outbox-publisher.tf || fail "Dedicated outbox publisher is missing."
grep -q 'command *= *\["node", "scripts/outbox-publisher-daemon.js"\]' outbox-publisher.tf || fail "Outbox command is invalid."
grep -q 'user_assigned_identity.outbox.id' outbox-publisher.tf || fail "Outbox must use its dedicated identity."
grep -q 'value = "bevoac_outbox"' outbox-publisher.tf || fail "Outbox must use bevoac_outbox."
pass "Dedicated outbox publisher is isolated."

grep -q 'APP_RUNTIME_MODE.*public_api' container-apps.tf || fail "Public API runtime mode is missing."
grep -q 'value = "bevoac_api"' container-apps.tf || fail "Public API must use bevoac_api."
grep -q 'value = "bevoac_worker"' container-apps.tf || fail "Worker must use bevoac_worker."
grep -q 'OUTBOX_PUBLISHER_ENABLED' container-apps.tf || fail "API outbox publisher flag is missing."
grep -q 'OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST' container-apps.tf || fail "API immediate publisher flag is missing."
grep -q 'custom_rule_type *= *"azure-servicebus"' container-apps.tf || fail "Worker Service Bus scale rule is missing."
grep -q 'identity_id *= *azurerm_user_assigned_identity.worker.id' container-apps.tf || fail "Worker scale rule must use Managed Identity."
if grep -q 'servicebus-connection-string' container-apps.tf; then
  fail "Worker Container App must not reference a Service Bus connection string."
fi
pass "API and worker runtime identities are explicit."

grep -q 'resource "azurerm_role_assignment" "api_kv_reader"' main.tf || fail "Staged legacy API Key Vault reader transition is missing."
grep -q 'count *= *var.retain_legacy_broad_key_vault_roles ? 1 : 0' main.tf || fail "Legacy Key Vault readers must be conditionally removable."
grep -q 'resource "azurerm_role_assignment" "api_sb_sender"' data-platform.tf || fail "Staged legacy API Service Bus Sender transition is missing."
grep -q 'count *= *var.retain_legacy_api_servicebus_sender ? 1 : 0' data-platform.tf || fail "Legacy API Service Bus Sender must be conditionally removable."
grep -q 'retain_legacy_broad_key_vault_roles *= *true' release/v6.1.3-workload-migration.tfvars.example || fail "Workload profile must retain legacy broad Key Vault roles during migration."
grep -q 'retain_legacy_broad_key_vault_roles *= *false' release/v6.1.3-security-finalize.tfvars.example || fail "Security profile must remove legacy broad Key Vault roles."
grep -q 'retain_legacy_api_servicebus_sender *= *true' release/v6.1.3-workload-migration.tfvars.example || fail "Workload profile must retain legacy API Sender during migration."
grep -q 'retain_legacy_api_servicebus_sender *= *false' release/v6.1.3-security-finalize.tfvars.example || fail "Security profile must remove legacy API Sender."
grep -q 'local_auth_enabled *= *var.service_bus_local_auth_enabled' data-platform.tf || fail "Service Bus local auth must be a staged variable."
grep -q 'minimum_tls_version *= *"1.2"' data-platform.tf || fail "Service Bus TLS 1.2 is required."
grep -q 'retain_legacy_servicebus_connection_secret' data-platform.tf || fail "Legacy Service Bus secret cleanup gate is missing."
pass "Service Bus uses staged Managed Identity hardening."

grep -q 'default_action *= *var.enable_private_endpoints ? "Deny" : "Allow"' main.tf || fail "Key Vault network ACL policy is missing."
[[ ! -f zz-enterprise-v6-1-3.auto.tfvars ]] || fail "Tracked auto.tfvars must not force a production network transition."
[[ -f release/v6.1.3-workload-migration.tfvars.example ]] || fail "Workload migration profile is missing."
[[ -f release/v6.1.3-security-finalize.tfvars.example ]] || fail "Security finalization profile is missing."
pass "Network closure is explicit and staged."

echo "Static IaC hardening checks passed."
