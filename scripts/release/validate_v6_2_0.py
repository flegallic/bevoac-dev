#!/usr/bin/env python3
"""Canonical self-validation for the Bevoac V6.2.0 remediation candidate."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

EXPECTED_VERSION = "6.2.0-client-ready-controlled-production"
EXPECTED_RELEASE_VERSION = "6.2.0-client-ready-controlled-production"
FORBIDDEN_ARTIFACT_RE = re.compile(
    r"(?:^|/)(?:"
    r"\.env(?:\.(?!example$)[^/]*)?$|"
    r"terraform\.tfstate(?:\.|$)|"
    r"tfplan(?:\.|$)|"
    r"\.terraform(?:/|$)|"
    r"__pycache__(?:/|$)|"
    r"artifacts(?:/|$)|"
    r"node_modules(?:/|$)|"
    r"\.next(?:/|$)|"
    r"coverage(?:/|$)|"
    r"\.nyc_output(?:/|$)|"
    r"dist(?:/|$)|"
    r"out(?:/|$)|"
    r"[^/]*\.tsbuildinfo$"
    r")|\.(?:pem|pfx|key|pyc)$",
    re.I,
)

REQUIRED_DOCS = (
    "docs/README.md",
    "docs/operations/runbook-v6-2.md",
    "docs/operations/monitoring-alerting-v6-2.md",
    "docs/operations/incident-response-v6-2.md",
    "docs/operations/postgres-backup-restore-v6-2.md",
    "docs/operations/release-validation-v6-2.md",
    "docs/technical/architecture-v6-2.md",
    "docs/technical/security-model-v6-2.md",
    "docs/technical/api-contract-v6-2.md",
    "docs/client/client-presentation-safe-v6-2.md",
    "docs/testing/test-strategy-v6-2.md",
    "docs/evidence/FINDINGS_CLOSURE_V6_2.md",
    "docs/evidence/FINDINGS_CLOSURE_V6_2.csv",
    "docs/evidence/SOURCE_VALIDATION_V6_2_0.md",
    "docs/MANIFEST.md",
    "CHANGELOG_V6_2_0.md",
    "APPLY_V6_2_0.md",
    "VALIDATION_MATRIX_V6_2_0.md",
    "SOURCE_BASELINE.json",
    "REMEDIATION_CLOSURE_MATRIX.md",
    "PACKAGE_CONTENTS.md",
    "RELEASE_CANDIDATE_LIMITATIONS.md",
    "VALIDATION_REPORT_V6_2_0.md",
    "SOURCE_CHANGE_SUMMARY.md",
)


class ValidationError(RuntimeError):
    pass


def read(path: Path) -> str:
    if not path.is_file():
        raise ValidationError(f"missing required file: {path}")
    return path.read_text(encoding="utf-8")


def require(text: str, markers: list[str], label: str) -> None:
    missing = [marker for marker in markers if marker not in text]
    if missing:
        raise ValidationError(f"{label}: missing markers: {missing}")


def run(command: list[str], cwd: Path, env: dict[str, str] | None = None) -> None:
    print(f"$ {' '.join(command)}", flush=True)
    result = subprocess.run(command, cwd=cwd, env=env, text=True)
    if result.returncode != 0:
        raise ValidationError(
            f"command failed ({result.returncode}): {' '.join(command)}"
        )


def release_candidate_files(root: Path):
    if (root / ".git").is_dir():
        result = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode != 0:
            raise ValidationError(
                "cannot enumerate release files from Git: "
                + result.stderr.decode("utf-8", errors="replace").strip()
            )
        for raw in result.stdout.split(b"\0"):
            if raw:
                path = root / raw.decode("utf-8")
                if path.is_file():
                    yield path
        return

    for path in root.rglob("*"):
        if path.is_file():
            yield path


def validate_versions(root: Path) -> None:
    if read(root / "RELEASE_VERSION").strip() != EXPECTED_RELEASE_VERSION:
        raise ValidationError("RELEASE_VERSION is not V6.2.0")
    for relative in (
        "bevoac-api-enterprise/package.json",
        "bevoac-api-enterprise/package-lock.json",
        "bevoac-worker-enterprise/package.json",
        "bevoac-worker-enterprise/package-lock.json",
    ):
        data = json.loads(read(root / relative))
        if data.get("version") != EXPECTED_VERSION:
            raise ValidationError(f"{relative}: expected {EXPECTED_VERSION}")
        if relative.endswith("package-lock.json"):
            root_pkg = data.get("packages", {}).get("", {})
            if root_pkg.get("version") != EXPECTED_VERSION:
                raise ValidationError(f"{relative}: root lock version mismatch")


def validate_runtime(root: Path) -> None:
    api = root / "bevoac-api-enterprise"
    worker = root / "bevoac-worker-enterprise"

    runtime_text = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for base in (api / "src", worker / "src")
        for path in base.rglob("*.js")
    )
    if "app.service_context" in runtime_text:
        raise ValidationError("mutable app.service_context remains active")

    require(
        read(api / "src/lib/db-context.js"),
        ["set_config('app.current_tenant_id'", "releaseError = rollbackError", "BEGIN", "ROLLBACK"],
        "tenant DB context",
    )
    require(
        read(api / "src/services/scan-service.js"),
        ["requestFingerprint", "IdempotencyConflictError", "error?.code === '23505'", "selectExisting"],
        "idempotency",
    )
    require(
        read(worker / "src/lib/resource-graph.js"),
        ["skipToken", "maxRows", "maxPages", "truncated", "azureAbortOptions"],
        "Resource Graph pagination",
    )
    require(
        read(worker / "src/services/message-processor.js"),
        [
            "markRetryable",
            "markRejectedMessage",
            "safeMessageIdentity",
            "compactValidationErrors",
            "abandonMessage",
            "deadLetterMessage",
            "classifyWorkerError",
            "count >= 1 ? count : 1",
            "PROVIDER_NOT_RUNTIME_ENABLED",
        ],
        "worker failure policy",
    )
    require(
        read(worker / "src/lib/module-timeout.js"),
        ["AbortController", "interruptionPromise", "MODULE_TIMEOUT"],
        "worker timeout cancellation",
    )
    require(
        read(worker / "src/lib/result-sanitizer.js"),
        ["sanitizeCustomerResult", "sanitizeString"],
        "result sanitizer",
    )
    require(
        read(api / "src/config/env.js"),
        ["PG_SSL_MODE=disable is forbidden in production", "managed_identity", "ADMIN_OIDC_TENANT_ID", "APIM_BACKEND_BOUNDARY_REQUIRED", "APP_RUNTIME_MODE=combined is forbidden in production"],
        "fail-closed configuration",
    )
    require(
        read(api / "src/lib/admin-oidc.js"),
        ["payload?.roles", "unauthorized tenant", "required application role", "jwtVerify"],
        "admin OIDC policy",
    )
    require(
        read(api / "src/plugins/auth-admin.js"),
        ["verifyOidcAdminToken", "shared_secret", "payload.roles"],
        "admin OIDC plugin",
    )
    require(
        read(api / "src/plugins/apim-backend-boundary.js"),
        ["Direct backend access is not allowed", "secureCompare"],
        "APIM backend boundary",
    )
    require(
        read(api / "src/lib/http-security-policy.js"),
        ["Cache-Control", "X-Content-Type-Options", "Referrer-Policy"],
        "HTTP security headers",
    )
    require(
        read(api / "src/lib/onboarding-state.js"),
        ["aes-256-gcm", "STATE_VERSION = 'v2'", "validatePayload"],
        "opaque onboarding state",
    )

    api_catalog = json.loads(read(api / "contracts/module-catalog.json"))
    worker_catalog = json.loads(read(worker / "contracts/module-catalog.json"))
    if api_catalog != worker_catalog:
        raise ValidationError("API and worker module catalogs differ")

    old_contract = worker / "contracts/scan-request.v7.multicloud.schema.json"
    if old_contract.exists():
        raise ValidationError("product-version-coupled v7 contract remains")
    contract = json.loads(read(worker / "contracts/scan-request.v2.multicloud.schema.json"))
    if contract.get("properties", {}).get("version", {}).get("const") != "2.0":
        raise ValidationError("multicloud contract is not semantic V2")

    frontend = root / "bevoac-frontend-enterprise"
    require(read(frontend / "README.md"), ["DEMO ONLY"], "frontend scope")
    frontend_runtime = "\n".join(
        p.read_text(encoding="utf-8", errors="ignore")
        for p in (frontend / "app").rglob("*.ts*")
    )
    if "sessionStorage" in frontend_runtime or "localStorage" in frontend_runtime:
        raise ValidationError("demo frontend persists browser credentials")

    static_onboarding = read(
        root / "bevoac-iac-enterprise/frontend/index.html.tftpl"
    )
    require(
        static_onboarding,
        ["DEMO ONLY", "ne collecte aucune clé API", "controlled_production"],
        "legacy static onboarding demo-only scope",
    )
    for forbidden in ("apiKey", "fetch(", "sessionStorage", "localStorage", "authorization"):
        if forbidden in static_onboarding:
            raise ValidationError(
                f"legacy static onboarding page retains active credential flow: {forbidden}"
            )

    # The catalog is the single source of truth for authorization and resource
    # preflight. Every historically missing Azure module must be present and
    # subscription-scoped modules must be preflighted.
    catalog_by_name = {entry["name"]: entry for entry in api_catalog.get("modules", [])}
    required_subscription_modules = {
        "exposure_map",
        "diagnostic_coverage",
        "encryption_coverage",
        "azure_rbac_exposure",
        "private_link_coverage",
        "policy_compliance",
    }
    missing_catalog = sorted(required_subscription_modules - set(catalog_by_name))
    if missing_catalog:
        raise ValidationError(f"module catalog is missing: {missing_catalog}")
    for name in required_subscription_modules:
        entry = catalog_by_name[name]
        if entry.get("scope") != "subscription" or entry.get("resourcePreflight") is not True:
            raise ValidationError(f"module catalog preflight is not enforced for {name}")
    entra_b2b = catalog_by_name.get("entra_b2b")
    if not entra_b2b or entra_b2b.get("scope") != "tenant" or entra_b2b.get("resourcePreflight") is not False:
        raise ValidationError("entra_b2b must remain tenant-scoped without subscription preflight")

    scan_service = read(api / "src/services/scan-service.js")
    require(
        scan_service,
        [
            "Idempotency-Key must not exceed 255 characters",
            "Idempotency-Key must not contain whitespace or control characters",
            "requestFingerprint",
            "selectExisting",
            "error?.code === '23505'",
        ],
        "request-bound idempotency",
    )

    scan_store = read(worker / "src/services/scan-store.js")
    require(
        scan_store,
        [
            "processing_attempt_id",
            "MESSAGE_REDELIVERED_AFTER_UNSETTLED_ATTEMPT",
            "SCAN_ATTEMPT_OWNERSHIP_LOST",
            "markRetryable",
            "markRejectedMessage",
            "SCAN_NOT_PENDING",
            "targetState: 'CONSUMED'",
            "targetState: 'REFUNDED'",
        ],
        "worker attempt ownership",
    )

    require(
        read(worker / "src/lib/status-semantics.js"),
        ["totalRoleAssignments", "totalEligibleResources", "PARTIAL"],
        "partial Resource Graph status semantics",
    )

    tags_scanner = read(worker / "scanners/azure/tags.js")
    require(tags_scanner, ["runResourceGraphQueryDetailed", "recordResourceGraphResult"], "tags pagination")
    if "ResourceGraphClient" in tags_scanner:
        raise ValidationError("tags scanner bypasses the central Resource Graph pagination helper")

    direct_resource_graph_clients = []
    for path in worker.rglob("*.js"):
        relative = path.relative_to(worker).as_posix()
        if FORBIDDEN_ARTIFACT_RE.search(relative):
            continue
        if relative in {"src/lib/resource-graph.js", "src/lib/resource-preflight.js"}:
            continue
        if "ResourceGraphClient" in path.read_text(encoding="utf-8", errors="ignore"):
            direct_resource_graph_clients.append(relative)
    if direct_resource_graph_clients:
        raise ValidationError(
            "direct ResourceGraphClient usage outside approved helpers: "
            + ", ".join(sorted(direct_resource_graph_clients))
        )

    api_env = read(api / "src/config/env.js")
    require(
        api_env,
        [
            "ALLOW_PG_SSL_REQUIRE_ROLLBACK",
            "ONBOARDING_STATE_SECRET must contain at least 32 characters in production",
            "APIM_BACKEND_SHARED_SECRET must contain at least 32 characters",
            "Missing required environment variable: MICROSOFT_CLIENT_ID",
            "Missing required environment variable: MICROSOFT_CLIENT_SECRET",
        ],
        "public API fail-closed configuration",
    )
    worker_env = read(worker / "src/config/env.js")
    require(
        worker_env,
        [
            "ALLOW_PG_SSL_REQUIRE_ROLLBACK",
            "WEB_ALLOWED_SCHEMES must be exactly https: in production",
            "Missing required environment variable: MICROSOFT_CLIENT_ID",
            "Missing required environment variable: MICROSOFT_CLIENT_SECRET",
        ],
        "worker fail-closed configuration",
    )

    require(
        read(api / "src/routes/health.js"),
        ["EMPTY_OBJECT_SCHEMA", "additionalProperties: false", "maxProperties: 0", "querystring: EMPTY_OBJECT_SCHEMA"],
        "health HTTP schemas",
    )
    require(
        read(api / "src/routes/admin-billing.js"),
        ["format: 'uuid'", "additionalProperties: false", "REQUIRED_MONTH_QUERY_SCHEMA"],
        "admin billing HTTP schemas",
    )
    require(
        read(api / "src/routes/onboarding-azure.js"),
        ["EMPTY_QUERY_SCHEMA", "CALLBACK_QUERY_SCHEMA", "additionalProperties: false"],
        "onboarding HTTP schemas",
    )

    frontend_route = read(frontend / "app/api/bevoac/route.ts")
    require(frontend_route, ["DEMO_ONLY_FRONTEND", "status: 410", "Cache-Control"], "frontend demo-only API")
    require(
        read(api / "Dockerfile"),
        ["FROM node:24-alpine", "npm ci --omit=dev", "/usr/local/lib/node_modules/npm", 'CMD ["node", "src/server.js"]'],
        "api container reproducibility and runtime hardening",
    )
    require(
        read(worker / "Dockerfile"),
        ["FROM node:24-alpine", "npm ci --omit=dev", "/usr/local/lib/node_modules/npm", 'CMD ["node", "src/index.js"]'],
        "worker container reproducibility and runtime hardening",
    )
    require(
        read(frontend / "Dockerfile"),
        ["FROM node:24-alpine", "npm ci --no-audit --no-fund", "/usr/local/lib/node_modules/npm", "npm run build"],
        "frontend Node baseline and runtime hardening",
    )
    require(
        read(root / "bevoac-api-enterprise/src/services/azure-onboarding-service.js"),
        ["'/v1/onboarding/azure/result'", "fragmentParams"],
        "credential-free onboarding result redirect",
    )
    require(
        read(root / "bevoac-api-enterprise/src/routes/onboarding-azure.js"),
        ["ONBOARDING_RESULT_HTML", "No client credential is requested or stored", "text/html; charset=utf-8"],
        "credential-free onboarding result page",
    )


def validate_iac(root: Path) -> None:
    iac = root / "bevoac-iac-enterprise"
    apim = read(iac / "api-gateway-apim.tf")
    require(
        apim,
        [
            "count               = var.enable_apim_gateway ? 1 : 0",
            "subscription_required = var.apim_subscription_required",
            "local.apim_backend_boundary_policy",
            "<rate-limit",
            "<validate-content",
        ],
        "APIM",
    )
    require(
        read(iac / "v620-apim-backend-boundary.tf"),
        ["random_password", "apim-backend-token", "secret              = true"],
        "APIM boundary IaC",
    )
    require(
        read(iac / "v620-controlled-production.tf"),
        ["controlled_production", "local_auth", "key_vault_ip_rules_effective", "monitoring", "onboarding_result_mode_requested", 'local.onboarding_result_mode_requested == "api"'],
        "controlled production profile",
    )
    require(
        read(iac / "monitoring-v620.tf"),
        ["azurerm_monitor_action_group", "azurerm_monitor_diagnostic_setting", "azurerm_monitor_activity_log_alert"],
        "monitoring IaC",
    )
    require(
        read(iac / "monitor-alerts.tf"),
        ["DeadletteredMessages", "ActiveMessages", "cpu_percent", "storage_percent"],
        "metric alerts",
    )
    require(
        read(iac / "data-platform.tf"),
        ["local_auth_enabled            = var.service_bus_local_auth_enabled", "retain_legacy_servicebus_connection_secret"],
        "Service Bus transition",
    )
    require(
        read(iac / "main.tf"),
        ["ip_rules                   = local.key_vault_ip_rules_effective", "default_action             = var.key_vault_network_default_action"],
        "Key Vault ACL",
    )
    require(
        read(iac / "release/v6.2.0-controlled-production.tfvars.example"),
        ["release_security_profile = \"controlled_production\"", "service_bus_local_auth_enabled", "enable_apim_backend_boundary", "monitor_notification_email", "onboarding_result_mode", "deploy_onboarding_frontend"],
        "V6.2 profile",
    )


def validate_database(root: Path) -> None:
    migration = read(
        root
        / "bevoac-api-enterprise/migrations/202608030001_v620_request_integrity_worker_resilience.sql"
    )
    require(
        migration,
        ["request_fingerprint", "error_code", "RETRYABLE", "DEAD_LETTERED"],
        "V6.2 migration",
    )
    expectations = read(
        root / "bevoac-api-enterprise/scripts/lib/enterprise-db-expectations.js"
    )
    require(
        expectations,
        ["202608030001_v620_request_integrity_worker_resilience", "EXPECTED_MIGRATIONS"],
        "DB expectations",
    )
    verifier = read(
        root / "bevoac-api-enterprise/scripts/verify-runtime-db-structure.js"
    )
    if re.search(
        r"client\.query\(\s*[`'\"]\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE)\b",
        verifier,
        re.I,
    ):
        raise ValidationError("runtime database verifier is not read-only")


def validate_docs(root: Path) -> None:
    for relative in REQUIRED_DOCS:
        read(root / relative)
    docs_readme = read(root / "docs/README.md")
    require(docs_readme, ["V6.2.0", "V6.3.0 AWS", "V7.0.0"], "docs baseline")

    source_baseline = json.loads(read(root / "SOURCE_BASELINE.json"))
    baseline = source_baseline.get("baseline", {})
    if baseline.get("commit") != "d9b85ad728a9f1252ca2acd0b9421cd5ec9a7ba4":
        raise ValidationError("SOURCE_BASELINE.json commit mismatch")
    if baseline.get("sourceArchiveSha256") != "f2448c3a71e05fc06e95457fa59035f3b4e7512c9085162ff026f5a4f091a588":
        raise ValidationError("SOURCE_BASELINE.json archive SHA mismatch")

    closure = read(root / "REMEDIATION_CLOSURE_MATRIX.md")
    require(
        closure,
        [
            "Validateur officiel incohérent",
            "Mauvais commit et mauvais SHA",
            "Nettoyage du contexte tenant PostgreSQL",
            "Contournement possible d’APIM",
            "Idempotence non liée au contenu",
            "Modules absents du resource preflight",
            "Resource Graph limité à 1 000 résultats",
            "Erreurs transitoires worker rendues terminales",
            "Validation HTTP et configuration non fail-closed",
            "Frontend démonstrateur présenté comme portail",
        ],
        "ten-finding closure matrix",
    )

    report = read(root / "VALIDATION_REPORT_V6_2_0.md")
    if "PENDING_FINAL_RUN" in report:
        raise ValidationError("V6.2 validation report still contains pending placeholders")
    require(
        report,
        [
            "LOCAL_STATIC_VALIDATION_OK=true",
            "TEN_PRIORITY_FINDINGS_SOURCE_INTEGRATED=true",
            "SOURCE_PACKAGE_PRODUCTION_ACCEPTED=false",
            "FULL_NODE24_DEPENDENCY_TESTS_EXECUTED=false",
            "TERRAFORM_VALIDATE_EXECUTED=false",
            "POSTGRESQL_INTEGRATION_EXECUTED=false",
        ],
        "V6.2 validation report",
    )
    source_validation = read(root / "docs/evidence/SOURCE_VALIDATION_V6_2_0.md")
    require(
        source_validation,
        [
            "RELEASE_STATIC_VALIDATION_OK=true",
            "SOURCE_SECURITY_GATE_OK=true",
            "LOCAL_STATIC_VALIDATION_OK=true",
            "markRejectedMessage",
            "Service Bus delivery count",
            "relative import",
        ],
        "source validation evidence",
    )


def validate_ci(root: Path) -> None:
    workflow = read(root / ".github/workflows/bevoac-enterprise-gates.yml")
    require(
        workflow,
        [
            "Source, secrets and documentation policy",
            "Demo frontend build and typecheck",
            "bevoac-frontend-enterprise/package-lock.json",
            "npm run typegen",
            "PostgreSQL, migrations and tenant isolation",
            "Terraform syntax, hardening and policy",
            "tf-vars: bevoac-iac-enterprise/release/v6.2.0-controlled-production.tfvars.example",
            "JavaScript and TypeScript SAST policy",
            "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
            "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
            "hashicorp/setup-terraform@dfe3c3f87815947d99a8997f908cb6525fc44e9e",
            "scripts/ci/js-ts-sast-gate.py",
            "js-ts-sast.sarif",
            "Container image build and vulnerability scan",
            "BEVOAC_ENTERPRISE_GATES_OK=true",
        ],
        "enterprise workflow",
    )
    forbidden_workflow_tokens = (
        "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
        "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
        "hashicorp/setup-terraform@b9cd54a3c349d3f38e8881555d616ced269862dd",
        "github/codeql-action/",
        "codeql-sarif-gate.py",
    )
    for token in forbidden_workflow_tokens:
        if token in workflow:
            raise ValidationError(f"deprecated or unavailable workflow integration remains active: {token}")
    for relative in (
        "scripts/ci/source-security-gate.sh",
        "scripts/ci/relative-import-gate.py",
        "scripts/ci/secret-pattern-scan.py",
        "scripts/ci/docs-gate.py",
        "scripts/ci/terraform-static-reference-check.py",
        "scripts/ci/js-ts-sast-gate.py",
        "scripts/release/test_v6_2_0_local.sh",
        "scripts/release/release_v6_2_0.sh",
        "scripts/release/collect_v6_2_0_evidence.sh",
    ):
        read(root / relative)

    local_validation = read(root / "scripts/release/test_v6_2_0_local.sh")
    require(
        local_validation,
        [
            "admin-billing-schema-v620.test.js",
            "db-context-v620.test.js",
            "scan-store-ownership-v620.test.js",
            "status-semantics-v620.test.js",
            "provider-boundary-runtime.test.js",
            "tags-resource-graph-pagination-v620.test.js",
            "relative-import-gate.py",
            "terraform-static-reference-check.py",
            "JSON_SCHEMA_META_VALIDATION_EXECUTED",
            "TYPESCRIPT_PARSE_EXECUTED",
        ],
        "local validation coverage",
    )

    require(
        read(root / "PACKAGE_AUDIT_REPORT.md"),
        ["d9b85ad728a9f1252ca2acd0b9421cd5ec9a7ba4", "f2448c3a71e05fc06e95457fa59035f3b4e7512c9085162ff026f5a4f091a588", "Expected migrations after upgrade: 9"],
        "package audit report",
    )


def validate_sensitive_paths(root: Path) -> None:
    for path in release_candidate_files(root):
        relative = path.relative_to(root).as_posix()
        if FORBIDDEN_ARTIFACT_RE.search(relative):
            raise ValidationError(f"sensitive/runtime artifact included: {relative}")


def validate_syntax(root: Path, node: str) -> None:
    candidates = sorted(release_candidate_files(root), key=lambda p: p.as_posix())
    javascript = [p for p in candidates if p.suffix.lower() == ".js"]
    shell = [p for p in candidates if p.suffix.lower() == ".sh"]
    json_files = [p for p in candidates if p.suffix.lower() == ".json"]
    yaml_files = [p for p in candidates if p.suffix.lower() in {".yml", ".yaml"}]

    print(f"SYNTAX_CANDIDATES_JS={len(javascript)}")
    print(f"SYNTAX_CANDIDATES_SH={len(shell)}")
    print(f"SYNTAX_CANDIDATES_JSON={len(json_files)}")
    print(f"SYNTAX_CANDIDATES_YAML={len(yaml_files)}")

    for path in javascript:
        run([node, "--check", str(path)], root)
    for path in shell:
        run(["bash", "-n", str(path)], root)
    for path in json_files:
        json.loads(path.read_text(encoding="utf-8"))

    try:
        import yaml  # type: ignore
    except ImportError:
        yaml = None
    if yaml:
        for path in yaml_files:
            if "cloudformation" in path.as_posix():
                continue
            yaml.safe_load(path.read_text(encoding="utf-8"))


def node_environment() -> tuple[str, dict[str, str]]:
    env = os.environ.copy()
    if shutil.which("brew"):
        result = subprocess.run(
            ["brew", "--prefix", "node@24"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        if result.returncode == 0:
            candidate = Path(result.stdout.strip()) / "bin"
            if (candidate / "node").exists():
                env["PATH"] = str(candidate) + os.pathsep + env.get("PATH", "")
    node = shutil.which("node", path=env.get("PATH"))
    if not node:
        raise ValidationError("Node.js is required")
    return node, env


def write_checksums(root: Path, output: Path) -> None:
    lines = []
    for path in sorted(release_candidate_files(root), key=lambda p: p.as_posix()):
        if path == output:
            continue
        lines.append(
            f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(root).as_posix()}"
        )
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--structure-only", action="store_true")
    parser.add_argument("--write-checksums", action="store_true")
    args = parser.parse_args()
    if args.full and args.structure_only:
        raise ValidationError("--full and --structure-only are mutually exclusive")

    root = args.repo.resolve()
    validate_versions(root)
    validate_runtime(root)
    validate_iac(root)
    validate_database(root)
    validate_docs(root)
    validate_ci(root)
    validate_sensitive_paths(root)

    node = None
    env = os.environ.copy()
    if not args.structure_only:
        node, env = node_environment()
        validate_syntax(root, node)

    if args.full:
        assert node is not None
        version = subprocess.run(
            [node, "--version"], text=True, stdout=subprocess.PIPE, env=env
        ).stdout.strip()
        if not version.startswith("v24."):
            raise ValidationError("--full requires Node.js 24")
        terraform = shutil.which("terraform", path=env.get("PATH"))
        if not terraform:
            raise ValidationError("--full requires Terraform")

        run(["bash", "scripts/ci/source-security-gate.sh"], root, env)
        for relative in ("bevoac-api-enterprise", "bevoac-worker-enterprise"):
            run(["npm", "ci"], root / relative, env)
            run(["npm", "run", "check"], root / relative, env)
            run(["npm", "test"], root / relative, env)
        run(
            ["npm", "ci", "--no-audit", "--no-fund"],
            root / "bevoac-frontend-enterprise",
            env,
        )
        run(["npm", "run", "typegen"], root / "bevoac-frontend-enterprise", env)
        run(["npm", "run", "typecheck"], root / "bevoac-frontend-enterprise", env)
        run(["npm", "run", "build"], root / "bevoac-frontend-enterprise", env)
        run([terraform, "fmt", "-check", "-recursive"], root / "bevoac-iac-enterprise", env)
        run([terraform, "init", "-backend=false", "-lockfile=readonly"], root / "bevoac-iac-enterprise", env)
        run([terraform, "validate"], root / "bevoac-iac-enterprise", env)
        run(["bash", "scripts/static-hardening-check.sh"], root / "bevoac-iac-enterprise", env)

    if args.write_checksums:
        write_checksums(root, root / "SOURCE_SHA256SUMS")

    print(f"NODE_VALIDATION_VERSION={subprocess.run([node, '--version'], text=True, stdout=subprocess.PIPE, env=env).stdout.strip() if node else 'not-required-structure-only'}")
    print("RELEASE_STATIC_VALIDATION_OK=true")
    print(f"STRUCTURE_ONLY={'true' if args.structure_only else 'false'}")
    print(f"FULL_VALIDATION={'true' if args.full else 'false'}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as error:
        print(f"RELEASE_VALIDATION_ERROR={error}", file=sys.stderr)
        raise SystemExit(1)
