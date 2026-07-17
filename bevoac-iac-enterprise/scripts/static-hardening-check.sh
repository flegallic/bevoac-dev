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
pass "APIM backend points to /v1."

grep -q 'azurerm_api_management_api_operation' api-gateway-apim.tf || fail "APIM proxy operations are missing."
grep -q 'url_template *= *"/\*"' api-gateway-apim.tf || fail "APIM proxy operation url_template must be /*."
pass "APIM proxy operations are declared."

grep -q 'subscription_required *= *true' api-gateway-apim.tf || fail "APIM subscription_required must be mandatory for V6.1.1 release lock."
pass "APIM subscription requirement is mandatory."

grep -q '<rate-limit calls="60" renewal-period="60"' api-gateway-apim.tf || fail "APIM API policy must include Consumption-compatible rate-limit."
grep -q '<validate-content unspecified-content-type-action="ignore" max-size="1048576" size-exceeded-action="prevent"' api-gateway-apim.tf || fail "APIM API policy must include validate-content request size protection."
grep -q 'X-Correlation-Id' api-gateway-apim.tf || fail "APIM policy must set X-Correlation-Id."
grep -q 'X-Bevoac-Gateway' api-gateway-apim.tf || fail "APIM policy must set X-Bevoac-Gateway."
pass "APIM API gateway hardening policies are declared."

grep -q 'resource "azurerm_api_management_product" "bevoac"' api-gateway-apim.tf || fail "APIM product is required for product-scoped subscriptions."
grep -q 'resource "azurerm_api_management_product_api" "bevoac"' api-gateway-apim.tf || fail "APIM API must be associated with the Bevoac product."
grep -q 'resource "azurerm_api_management_product_policy" "bevoac"' api-gateway-apim.tf || fail "APIM product policy is required for quota on Consumption SKU."
grep -q '<quota calls="5000" renewal-period="86400"' api-gateway-apim.tf || fail "APIM product policy must include product-scoped quota."
pass "APIM product-scoped quota policy is declared."

grep -q 'output "service_bus_namespace_short"' outputs.tf || fail "Missing output service_bus_namespace_short."
grep -q 'output "service_bus_queue_name"' outputs.tf || fail "Missing output service_bus_queue_name."
grep -q 'output "retention_job_name"' outputs.tf || fail "Missing output retention_job_name."
grep -q 'output "apim_gateway_url"' outputs.tf || fail "Missing output apim_gateway_url."
grep -R -q 'output "outbox_publisher_container_app_name"' . || fail "Missing output outbox_publisher_container_app_name."
pass "Operational outputs are present."

if grep -q 'trigger_type *= *"Schedule"' retention-job.tf; then
  fail "retention-job.tf must not use unsupported trigger_type."
fi
pass "Retention job avoids unsupported trigger_type."

if grep -q 'env { name =' retention-job.tf; then
  fail "retention-job.tf must not use single-line env blocks."
fi
pass "Retention job env blocks are multiline."

grep -q 'resource "azurerm_container_app" "outbox_publisher"' outbox-publisher.tf || fail "Dedicated outbox publisher Container App is missing."
grep -q 'command *= *\["node", "scripts/outbox-publisher-daemon.js"\]' outbox-publisher.tf || fail "Dedicated outbox publisher must run scripts/outbox-publisher-daemon.js."
pass "Dedicated outbox publisher is declared."

grep -q 'OUTBOX_PUBLISHER_ENABLED' container-apps.tf || fail "API runtime must explicitly configure OUTBOX_PUBLISHER_ENABLED."
grep -q 'OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST' container-apps.tf || fail "API runtime must explicitly configure OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST."
pass "API outbox publisher flags are explicit."

echo "Static IaC hardening checks passed."
