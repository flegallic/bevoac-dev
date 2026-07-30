#!/usr/bin/env python3
"""Self-validation for the complete Bevoac V6.1.3 enterprise release source."""
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

EXPECTED_VERSION = "6.1.3-production-ready"
FORBIDDEN_ACTIVE_DOC_RE = re.compile(r"(?:v5[-_]?3|v6[-_]?1[-_]?1|v5[-_]?2|v5[-_]?1)", re.I)
FORBIDDEN_ARTIFACT_RE = re.compile(r"(^|/)(?:\.env(?:\.(?!example$)[^/]*)?$|terraform\.tfstate(?:\.|$)|tfplan(?:\.|$)|\.terraform/|__pycache__/)|\.(?:pem|pfx|key|pyc)$", re.I)

class ValidationError(RuntimeError):
    pass

def run(command: list[str], cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    """Run a command with live output while retaining it for diagnostics."""
    print(f"$ {' '.join(command)}", flush=True)
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1,
    )
    output: list[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        output.append(line)
        print(line, end="", flush=True)
    returncode = process.wait()
    result = subprocess.CompletedProcess(command, returncode, "".join(output))
    if result.returncode != 0:
        raise ValidationError(f"command failed ({result.returncode}): {' '.join(command)}")
    return result

def read(path: Path) -> str:
    if not path.is_file():
        raise ValidationError(f"missing required file: {path}")
    return path.read_text(encoding="utf-8")

def require(text: str, markers: list[str], label: str) -> None:
    missing = [marker for marker in markers if marker not in text]
    if missing:
        raise ValidationError(f"{label}: missing markers: {missing}")

def validate_versions(root: Path) -> None:
    for relative in (
        "bevoac-api-enterprise/package.json",
        "bevoac-api-enterprise/package-lock.json",
        "bevoac-worker-enterprise/package.json",
        "bevoac-worker-enterprise/package-lock.json",
    ):
        data = json.loads(read(root / relative))
        if data.get("version") != EXPECTED_VERSION:
            raise ValidationError(f"{relative}: expected version {EXPECTED_VERSION}")
        if relative.endswith("package-lock.json") and data.get("packages", {}).get("", {}).get("version") != EXPECTED_VERSION:
            raise ValidationError(f"{relative}: root package lock version mismatch")

def validate_runtime(root: Path) -> None:
    runtime_text = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for base in (root / "bevoac-api-enterprise/src", root / "bevoac-worker-enterprise/src")
        for path in base.rglob("*.js")
    )
    if "app.service_context" in runtime_text:
        raise ValidationError("app.service_context is present in active runtime source")
    api_provider = read(root / "bevoac-api-enterprise/src/lib/cloud-provider-contract.js")
    require(api_provider, ["azure", "aws", "gcp", "runtimeEnabled: true", "runtimeEnabled: false"], "API provider boundary")
    worker_registry = read(root / "bevoac-worker-enterprise/src/providers/provider-registry.js")
    require(worker_registry, ["PROVIDER_CONTRACT_VERSION", "azure", "aws", "gcp", "assertProviderRuntimeEnabled"], "worker provider registry")
    worker_index = read(root / "bevoac-worker-enterprise/src/index.js")
    require(worker_index, ["processScanMessage", "startWorker"], "worker runtime entrypoint")
    processor = read(root / "bevoac-worker-enterprise/src/services/message-processor.js")
    require(processor, ["assertProviderRuntimeEnabled", "PROVIDER_NOT_RUNTIME_ENABLED", "buildDefaultDependencies"], "worker provider dispatch")

def validate_iac(root: Path) -> None:
    iac = root / "bevoac-iac-enterprise"
    apps = read(iac / "container-apps.tf")
    require(apps, [
        'value = "public_api"', 'value = "bevoac_api"', 'value = "bevoac_worker"',
        'custom_rule_type = "azure-servicebus"', 'identity_id      = azurerm_user_assigned_identity.worker.id',
        'OUTBOX_PUBLISHER_ENABLED', 'OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST',
    ], "container apps")
    if "servicebus-connection-string" in apps or "pg_admin_username" in apps:
        raise ValidationError("container-apps.tf retains a legacy runtime secret or admin user")

    require(read(iac / "outbox-publisher.tf"), ["user_assigned_identity.outbox", 'value = "bevoac_outbox"', "pg-outbox-password"], "outbox")
    require(read(iac / "retention-job.tf"), ["user_assigned_identity.retention", 'value = "bevoac_retention"', "pg-retention-password"], "retention")
    require(read(iac / "admin-api.tf"), ['value = "admin_api"', 'value = "bevoac_admin_api"', "pg-admin-api-password", "external_enabled = false", 'value = "oidc"'], "admin API")

    main = read(iac / "main.tf")
    data = read(iac / "data-platform.tf")
    workload = read(iac / "workload-security-phase1.tf")
    require(main, [
        'resource "azurerm_role_assignment" "api_kv_reader"',
        'resource "azurerm_role_assignment" "worker_kv_reader"',
        'count                = var.retain_legacy_broad_key_vault_roles ? 1 : 0',
        'default_action = var.enable_private_endpoints ? "Deny" : "Allow"',
    ], "staged Key Vault transition")
    require(data, [
        'resource "azurerm_role_assignment" "api_sb_sender"',
        'count                = var.retain_legacy_api_servicebus_sender ? 1 : 0',
    ], "staged API Service Bus Sender transition")
    require(data, [
        "local_auth_enabled            = var.service_bus_local_auth_enabled",
        "retain_legacy_servicebus_connection_secret",
        'minimum_tls_version           = "1.2"',
    ], "Service Bus phased hardening")
    require(workload, ["api_pg_secret_reader", "worker_pg_secret_reader", "outbox_sb_sender", "retention_pg_secret_reader", "admin_api_pg_secret_reader"], "secret-scoped workload RBAC")
    if (iac / "zz-enterprise-v6-1-3.auto.tfvars").exists():
        raise ValidationError("tracked auto.tfvars would force an unsafe implicit transition")
    migration_profile = read(iac / "release/v6.1.3-workload-migration.tfvars.example")
    finalize_profile = read(iac / "release/v6.1.3-security-finalize.tfvars.example")
    require(migration_profile, [
        "service_bus_local_auth_enabled = true",
        "retain_legacy_servicebus_connection_secret = true",
        "retain_legacy_broad_key_vault_roles = true",
        "retain_legacy_api_servicebus_sender = true",
    ], "workload migration profile")
    require(finalize_profile, [
        "service_bus_local_auth_enabled = false",
        "retain_legacy_servicebus_connection_secret = false",
        "retain_legacy_broad_key_vault_roles = false",
        "retain_legacy_api_servicebus_sender = false",
        "enable_private_endpoints = true",
        "enable_postgres_public_access = false",
    ], "security finalization profile")

def validate_database_tooling(root: Path) -> None:
    api_root = root / "bevoac-api-enterprise"
    package = json.loads(read(api_root / "package.json"))
    scripts = package.get("scripts", {})
    for legacy_name in (
        "init-db:prod-hardening",
        "migrate-db:enterprise-hardening",
        "migrate-db:rls",
        "migrate-db:enterprise-rls",
    ):
        if legacy_name in scripts:
            raise ValidationError(f"legacy schema command remains exposed: {legacy_name}")
    if scripts.get("check:rls") != "node scripts/verify-runtime-db-structure.js":
        raise ValidationError("check:rls must use the exact runtime database verifier")
    for relative in (
        "scripts/init-db.production-hardening.js",
        "scripts/apply-enterprise-hardening-migration.js",
        "scripts/apply-rls-migration.js",
        "scripts/apply-enterprise-rls.js",
    ):
        legacy = read(api_root / relative)
        require(legacy, ["BLOCKED:", "process.exitCode = 1"], relative)

    expectations = read(root / "bevoac-api-enterprise/scripts/lib/enterprise-db-expectations.js")
    require(expectations, ["EXPECTED_MIGRATIONS", "EXPECTED_RLS_TABLES", "EXPECTED_GRANTS", "202607170001_runtime_role_rls_boundary_optional"], "database expectations")
    verifier = read(root / "bevoac-api-enterprise/scripts/verify-runtime-db-structure.js")
    require(verifier, ["Verifier must run as bevoacadmin", "ENTERPRISE_RUNTIME_DB_STRUCTURE_OK", "Expected 29 policies", "Expected 58 grants"], "database verifier")
    if re.search(r"client\.query\(\s*[`'\"]\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE)\b", verifier, re.I):
        raise ValidationError("database verifier is not read-only")

def validate_docs(root: Path) -> None:
    required = (
        "docs/operations/Runbook_Bevoac_V6_1_2_Production_Enterprise_Ready_R3.docx",
        "docs/operations/Guide_From_Scratch_Bevoac_V6_1_2_R3.docx",
        "docs/operations/Bevoac_V6_1_3_Enterprise_Release_Deployment_Guide.docx",
        "docs/operations/RELEASE_NOTES_V6_1_3.md",
        "docs/multicloud/MULTICLOUD_READINESS_V6_1_3.md",
        "docs/architecture/ADR-006-runtime-identities-and-provider-boundary.md",
    )
    for relative in required:
        path = root / relative
        if not path.is_file():
            raise ValidationError(f"missing required file: {path}")
        if path.suffix.lower() != ".docx":
            path.read_text(encoding="utf-8")
    for directory in (root / "docs/mermaid", root / "docs/diagrams", root / "docs/operations", root / "docs/technical"):
        for path in directory.iterdir():
            if path.is_file() and FORBIDDEN_ACTIVE_DOC_RE.search(path.name):
                raise ValidationError(f"legacy-versioned document remains active: {path.relative_to(root)}")

def validate_scripts(root: Path) -> None:
    deploy = read(root / "scripts/release/deploy_v6_1_3.sh")
    require(deploy, ["plan-workloads", "apply-workloads", "smoke-workloads", "plan-security", "apply-security", "smoke-final", "BEVOAC_APIM_SUBSCRIPTION_KEY", "service_bus_local_auth_enabled"], "deployment script")
    require(read(root / "scripts/ci/postgres-enterprise-gate.sh"), ["postgres", "BEVOAC_INTEGRATION_DB=1", "runtime-role-rls"], "PostgreSQL CI gate")
    workflow = read(root / ".github/workflows/bevoac-enterprise-gates.yml")
    require(workflow, ["postgres:16-alpine", "node-version: '24'", "terraform fmt -check -recursive", "postgres-enterprise-gate.sh"], "GitHub Actions workflow")

def release_candidate_files(root: Path):
    """Yield files that belong to the release candidate.

    A packaged source tree has no .git directory, so every file is validated.
    In a developer working tree, tracked files and untracked non-ignored files
    are validated; Git-ignored runtime material such as .env, .terraform and
    terraform.tfstate.backup is deliberately excluded because it is local
    operator state, not release content.
    """
    if (root / ".git").is_dir():
        result = subprocess.run(
            [
                "git",
                "ls-files",
                "--cached",
                "--others",
                "--exclude-standard",
                "-z",
            ],
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
            if not raw:
                continue
            relative = raw.decode("utf-8", errors="strict")
            path = root / relative
            if path.is_file():
                yield path
        return

    for path in root.rglob("*"):
        if path.is_file():
            yield path


def validate_sensitive_paths(root: Path) -> None:
    for path in release_candidate_files(root):
        relative = path.relative_to(root).as_posix()
        if FORBIDDEN_ARTIFACT_RE.search(relative):
            raise ValidationError(f"sensitive/runtime artifact included: {relative}")

def validate_syntax(root: Path, node: str) -> None:
    """Validate only release-candidate files, never Git-ignored runtime trees.

    In a developer repository this excludes node_modules, .terraform, .env and
    local state through Git's own ignore rules. In a packaged source tree every
    packaged file is eligible, and node_modules is absent before npm ci runs.
    """
    candidates = sorted(release_candidate_files(root), key=lambda path: path.as_posix())
    javascript = [path for path in candidates if path.suffix.lower() == ".js"]
    shell = [path for path in candidates if path.suffix.lower() == ".sh"]
    json_files = [path for path in candidates if path.suffix.lower() == ".json"]

    print(f"SYNTAX_CANDIDATES_JS={len(javascript)}", flush=True)
    print(f"SYNTAX_CANDIDATES_SH={len(shell)}", flush=True)
    print(f"SYNTAX_CANDIDATES_JSON={len(json_files)}", flush=True)

    for path in javascript:
        run([node, "--check", str(path)], root)
    for path in shell:
        run(["bash", "-n", str(path)], root)
    for path in json_files:
        json.loads(path.read_text(encoding="utf-8"))

def node_environment(root: Path) -> tuple[str, dict[str, str]]:
    env = os.environ.copy()
    if shutil.which("brew"):
        result = subprocess.run(["brew", "--prefix", "node@24"], text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            candidate = Path(result.stdout.strip()) / "bin"
            if (candidate / "node").exists():
                env["PATH"] = str(candidate) + os.pathsep + env.get("PATH", "")
    node = shutil.which("node", path=env.get("PATH"))
    if not node:
        raise ValidationError("Node.js is required")
    version = subprocess.run([node, "--version"], text=True, stdout=subprocess.PIPE, env=env).stdout.strip()
    env["BEVOAC_NODE_VERSION"] = version
    return node, env

def checksums(root: Path, output: Path) -> None:
    lines=[]
    candidates = sorted(release_candidate_files(root), key=lambda path: path.as_posix())
    for path in candidates:
        if path == output:
            continue
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        lines.append(f"{digest}  {path.relative_to(root).as_posix()}")
    output.write_text("\n".join(lines)+"\n", encoding="utf-8")

def main() -> int:
    parser=argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--full", action="store_true", help="run npm and Terraform gates in addition to static validation")
    parser.add_argument(
        "--structure-only",
        action="store_true",
        help="validate release structure and sensitive paths without repeating syntax gates",
    )
    parser.add_argument("--write-checksums", action="store_true")
    args=parser.parse_args()
    root=args.repo.resolve()

    validate_versions(root)
    validate_runtime(root)
    validate_iac(root)
    validate_database_tooling(root)
    validate_docs(root)
    validate_scripts(root)
    validate_sensitive_paths(root)

    if args.full and args.structure_only:
        raise ValidationError("--full and --structure-only are mutually exclusive")

    node: str | None = None
    env = os.environ.copy()
    if not args.structure_only:
        node, env = node_environment(root)
        validate_syntax(root, node)

    if args.full:
        assert node is not None
        if not subprocess.run([node, "--version"], stdout=subprocess.PIPE, text=True, env=env).stdout.strip().startswith("v24."):
            raise ValidationError("--full requires Node.js 24")
        terraform=shutil.which("terraform")
        if not terraform:
            raise ValidationError("--full requires Terraform")

        # Cheap deterministic gates run first so formatting/configuration errors
        # fail before npm dependency installation and the full test suites.
        run([terraform, "fmt", "-check", "-recursive"], root/"bevoac-iac-enterprise", env)

        for relative in ("bevoac-api-enterprise", "bevoac-worker-enterprise"):
            run(["npm", "ci"], root/relative, env)
            run(["npm", "run", "check"], root/relative, env)
            run(["npm", "test"], root/relative, env)

        run([terraform, "init", "-backend=false"], root/"bevoac-iac-enterprise", env)
        run([terraform, "validate"], root/"bevoac-iac-enterprise", env)
        run(["bash", "scripts/static-hardening-check.sh"], root/"bevoac-iac-enterprise", env)

    if args.write_checksums:
        checksums(root, root/"SOURCE_SHA256SUMS")
    if node is not None:
        version = subprocess.run([node, "--version"], stdout=subprocess.PIPE, text=True, env=env).stdout.strip()
        print(f"NODE_VALIDATION_VERSION={version}")
    else:
        print("NODE_VALIDATION_VERSION=not-required-structure-only")
    print("RELEASE_STATIC_VALIDATION_OK=true")
    print(f"STRUCTURE_ONLY={'true' if args.structure_only else 'false'}")
    print(f"FULL_VALIDATION={'true' if args.full else 'false'}")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValidationError, OSError, json.JSONDecodeError) as error:
        print(f"VALIDATION_ERROR={error}", file=sys.stderr)
        raise SystemExit(1)
