#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bash "$REPO_ROOT/VERIFY_SOURCE_PACKAGE.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "SOURCE_SECURITY_GATE_ERROR=$1" >&2
  exit 1
}

TMP_FILES="$(mktemp "${TMPDIR:-/tmp}/bevoac-release-files.XXXXXX")"
TMP_SENSITIVE="$(mktemp "${TMPDIR:-/tmp}/bevoac-sensitive-files.XXXXXX")"
cleanup() {
  rm -f "$TMP_FILES" "$TMP_SENSITIVE"
}
trap cleanup EXIT

list_release_files() {
  if [[ -d .git ]] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    # The gate must cover the complete release candidate, including newly added
    # files that are not committed yet. Ignored local build/runtime artifacts are
    # deliberately excluded by Git's ignore rules.
    git ls-files --cached --others --exclude-standard
  else
    find . -type f \
      -not -path './.git/*' \
      -not -path './node_modules/*' \
      -not -path './.terraform/*' \
      -not -path './__pycache__/*' \
      -not -path './artifacts/*' \
      -not -path '*/.next/*' \
      -not -path '*/coverage/*' \
      -print | sed 's#^./##'
  fi
}

list_release_files | LC_ALL=C sort -u > "$TMP_FILES"

# No runtime secret/state artifacts may be included in the release candidate.
grep -E '(^|/)(\.env($|\.)|terraform\.tfstate($|\.)|terraform\.tfvars($|\.)|.*\.(pem|pfx|key)$)' "$TMP_FILES" \
  | grep -vE '(^|/)\.env\.example$' \
  > "$TMP_SENSITIVE" || true
if [[ -s "$TMP_SENSITIVE" ]]; then
  cat "$TMP_SENSITIVE" >&2
  fail "sensitive release filenames detected"
fi

# V6.2.0 invariants required by the remediation baseline.
grep -q "requestFingerprint" bevoac-api-enterprise/src/services/scan-service.js || fail "idempotency fingerprint missing"
grep -q "withTenantTransaction" bevoac-api-enterprise/src/lib/db-context.js || fail "transaction-local tenant context missing"
grep -q "APIM_BACKEND_BOUNDARY_REQUIRED" bevoac-api-enterprise/src/config/env.js || fail "APIM boundary config missing"
grep -q "markRejectedMessage" bevoac-worker-enterprise/src/services/message-processor.js || fail "invalid-message persistence boundary missing"
grep -q "count >= 1 ? count : 1" bevoac-worker-enterprise/src/services/message-processor.js || fail "Service Bus delivery count is not one-based"
grep -q "totalRoleAssignments" bevoac-worker-enterprise/src/lib/status-semantics.js || fail "RBAC partial-status semantics missing"
grep -q "totalEligibleResources" bevoac-worker-enterprise/src/lib/status-semantics.js || fail "Private Link partial-status semantics missing"
grep -q "X-Bevoac-Backend-Token" bevoac-iac-enterprise/v620-apim-backend-boundary.tf || fail "APIM boundary IaC missing"
grep -q "local_auth_enabled" bevoac-iac-enterprise/data-platform.tf || fail "Service Bus local auth control missing"
grep -q "azurerm_monitor_diagnostic_setting" bevoac-iac-enterprise/monitoring-v620.tf || fail "diagnostic settings missing"
grep -Eq "DEMO[- ]ONLY" bevoac-frontend-enterprise/README.md || fail "frontend demo-only classification missing"
grep -q "default     = false" <(sed -n '/variable "deploy_onboarding_frontend"/,/^}/p' bevoac-iac-enterprise/variables.tf) || fail "legacy static onboarding frontend must default to disabled"
grep -q 'local.onboarding_result_mode_requested == "api"' bevoac-iac-enterprise/v620-controlled-production.tf || fail "controlled production must explicitly require the credential-free API onboarding result mode"
grep -Eq 'onboarding_result_mode[[:space:]]*=[[:space:]]*"api"' bevoac-iac-enterprise/release/v6.2.0-controlled-production.tfvars.example || fail "controlled production release profile must select API onboarding results"

grep -q "No client credential is requested or stored" bevoac-api-enterprise/src/routes/onboarding-azure.js || fail "credential-free API onboarding result page missing"
grep -q "https://onboarding.bevoac.fr/v1/onboarding/azure" bevoac-api-enterprise/src/lib/onboarding-result-assets.js || fail "canonical onboarding landing URL missing"
grep -q "'/v1/onboarding/azure/browser-start'" bevoac-api-enterprise/src/lib/apim-boundary.js || fail "browser onboarding bootstrap boundary exemption missing"
grep -q "requireOnboardingBrowserOrigin" bevoac-api-enterprise/src/routes/onboarding-azure.js || fail "browser onboarding origin guard missing"
grep -q "fastify.authenticateApiKey" bevoac-api-enterprise/src/routes/onboarding-azure.js || fail "browser onboarding API-key authentication missing"

# The retained Storage static website is a compatibility bridge only. It must
# never collect credentials or run an active API flow.
grep -q "DEMO ONLY" bevoac-iac-enterprise/frontend/index.html.tftpl || fail "legacy static onboarding source classification missing"
grep -q "does not collect or store any API key" bevoac-iac-enterprise/frontend/index.html.tftpl || fail "legacy static onboarding page must state that it collects no API key"
grep -q '\${onboarding_url}' bevoac-iac-enterprise/frontend/index.html.tftpl || fail "legacy static onboarding page must link to canonical API landing"
if grep -Eq 'apiKey|fetch\(|sessionStorage|localStorage|authorization' bevoac-iac-enterprise/frontend/index.html.tftpl; then
  fail "legacy static onboarding page retains an active credential/API flow"
fi

# Client-facing API pages must not expose the retired Storage endpoint or the
# technical generated ACA API hostname.
if grep -Eq 'stbevoacprodfront|z28\.web\.core\.windows\.net|ca-bevoac-prod-api\.lemonbeach' \
  bevoac-api-enterprise/src/lib/onboarding-result-assets.js \
  bevoac-api-enterprise/src/routes/onboarding-azure.js; then
  fail "client-facing onboarding API page exposes a technical infrastructure URL"
fi

# The demo frontend must not retain customer credentials in browser storage.
if grep -RInE 'sessionStorage|localStorage' bevoac-frontend-enterprise/app --include='*.ts' --include='*.tsx'; then
  fail "browser credential persistence detected in frontend"
fi

# The retired product-version-based contract name must not remain active.
if find bevoac-worker-enterprise/contracts -maxdepth 1 -type f -name '*v7*multicloud*' | grep -q .; then
  fail "product-version-coupled multicloud contract remains active"
fi

node bevoac-api-enterprise/scripts/sync-contracts.js
python3 scripts/ci/relative-import-gate.py --repo "$ROOT"
python3 scripts/ci/terraform-static-reference-check.py --repo "$ROOT"
python3 scripts/ci/docs-gate.py --repo "$ROOT"
python3 scripts/ci/secret-pattern-scan.py --repo "$ROOT"

echo "SOURCE_RELEASE_FILE_COUNT=$(wc -l < "$TMP_FILES" | tr -d ' ')"
echo "SOURCE_SECURITY_GATE_OK=true"
