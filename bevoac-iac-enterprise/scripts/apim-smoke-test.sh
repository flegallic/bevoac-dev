#!/usr/bin/env bash
set -euo pipefail

: "${APIM_URL:?Set APIM_URL, for example terraform output -raw apim_gateway_url}"
: "${BEVOAC_API_KEY:?Set BEVOAC_API_KEY with a Bevoac tenant API key}"

if [[ "${APIM_SUBSCRIPTION_REQUIRED:-true}" == "true" ]]; then
  : "${APIM_SUBSCRIPTION_KEY:?Set APIM_SUBSCRIPTION_KEY because APIM_SUBSCRIPTION_REQUIRED=true}"
  APIM_HEADER=(-H "Ocp-Apim-Subscription-Key: ${APIM_SUBSCRIPTION_KEY}")
else
  APIM_HEADER=()
fi

echo "[INFO] Testing APIM health"
health_code=$(curl -s -o /tmp/bevoac-apim-health.json -w "%{http_code}" "${APIM_URL}/v1/health" "${APIM_HEADER[@]}")
if [[ "$health_code" != "200" ]]; then
  echo "[ERROR] APIM /v1/health expected 200, got ${health_code}" >&2
  cat /tmp/bevoac-apim-health.json >&2 || true
  exit 1
fi

echo "[INFO] Testing Bevoac auth through APIM"
no_auth_code=$(curl -s -o /tmp/bevoac-apim-no-auth.json -w "%{http_code}" "${APIM_URL}/v1/scans" "${APIM_HEADER[@]}")
if [[ "$no_auth_code" != "401" ]]; then
  echo "[ERROR] APIM /v1/scans without Bevoac key expected 401, got ${no_auth_code}" >&2
  cat /tmp/bevoac-apim-no-auth.json >&2 || true
  exit 1
fi

list_code=$(curl -s -o /tmp/bevoac-apim-list.json -w "%{http_code}" "${APIM_URL}/v1/scans" "${APIM_HEADER[@]}" -H "Authorization: Bearer ${BEVOAC_API_KEY}")
if [[ "$list_code" != "200" ]]; then
  echo "[ERROR] APIM /v1/scans with Bevoac key expected 200, got ${list_code}" >&2
  cat /tmp/bevoac-apim-list.json >&2 || true
  exit 1
fi

echo "[OK] APIM smoke test passed."
