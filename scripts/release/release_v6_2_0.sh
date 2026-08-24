#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IAC="$ROOT/bevoac-iac-enterprise"
API="$ROOT/bevoac-api-enterprise"
ARTIFACTS="${V620_RELEASE_ARTIFACTS:-$ROOT/artifacts/v6.2.0-release}"
PLAN_FILE="${V620_PLAN_FILE:-$ARTIFACTS/terraform-v6.2.0.tfplan}"
PLAN_SHA_FILE="$PLAN_FILE.sha256"
mkdir -p "$ARTIFACTS"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "BLOCKED=missing_command:$1" >&2
    exit 1
  }
}

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

require_clean_git() {
  [[ -d "$ROOT/.git" ]] || {
    echo "BLOCKED=git_repository_required" >&2
    exit 1
  }
  git -C "$ROOT" diff --quiet --
  git -C "$ROOT" diff --cached --quiet --
}

validate_source() {
  cd "$ROOT"
  bash scripts/release/test_v6_2_0_local.sh
}

validate_full() {
  cd "$ROOT"
  ./validate_release.sh --full
}

plan() {
  need terraform
  need shasum
  require_clean_git
  [[ -n "${TFVARS_FILE:-}" && -f "$TFVARS_FILE" ]] || {
    echo "BLOCKED=TFVARS_FILE_absolute_existing_path_required" >&2
    exit 1
  }
  case "$TFVARS_FILE" in
    /*) ;;
    *) echo "BLOCKED=TFVARS_FILE_must_be_absolute" >&2; exit 1 ;;
  esac

  terraform -chdir="$IAC" fmt -check -recursive
  terraform -chdir="$IAC" init
  terraform -chdir="$IAC" validate
  terraform -chdir="$IAC" plan \
    -input=false \
    -lock-timeout=60s \
    -var-file="$TFVARS_FILE" \
    -out="$PLAN_FILE"
  terraform -chdir="$IAC" show -json "$PLAN_FILE" > "$PLAN_FILE.json"
  sha256_file "$PLAN_FILE" > "$PLAN_SHA_FILE"
  chmod 600 "$PLAN_FILE" "$PLAN_FILE.json" "$PLAN_SHA_FILE"
  echo "PLAN_FILE=$PLAN_FILE"
  echo "PLAN_SHA256=$(cat "$PLAN_SHA_FILE")"
  echo "TERRAFORM_PLAN_CREATED=true"
  echo "TERRAFORM_APPLIED=false"
}

show_plan() {
  need terraform
  [[ -f "$PLAN_FILE" ]] || { echo "BLOCKED=plan_not_found" >&2; exit 1; }
  terraform -chdir="$IAC" show "$PLAN_FILE"
  echo "PLAN_SHA256=$(sha256_file "$PLAN_FILE")"
}

apply_plan() {
  need terraform
  need shasum
  require_clean_git
  [[ "${CONFIRM_V620_TERRAFORM_APPLY:-}" == "YES" ]] || {
    echo "BLOCKED=CONFIRM_V620_TERRAFORM_APPLY_must_equal_YES" >&2
    exit 1
  }
  [[ -f "$PLAN_FILE" && -f "$PLAN_SHA_FILE" ]] || {
    echo "BLOCKED=approved_plan_or_hash_missing" >&2
    exit 1
  }
  actual="$(sha256_file "$PLAN_FILE")"
  recorded="$(cat "$PLAN_SHA_FILE")"
  [[ "$actual" == "$recorded" ]] || { echo "BLOCKED=plan_hash_changed" >&2; exit 1; }
  [[ -n "${EXPECTED_PLAN_SHA256:-}" && "$actual" == "$EXPECTED_PLAN_SHA256" ]] || {
    echo "BLOCKED=EXPECTED_PLAN_SHA256_mismatch" >&2
    exit 1
  }
  terraform -chdir="$IAC" apply -input=false -lock-timeout=60s "$PLAN_FILE"
  echo "APPLIED_PLAN_SHA256=$actual"
  echo "TERRAFORM_APPLIED=true"
}

migrate_db() {
  need node
  need npm
  require_clean_git
  [[ "${CONFIRM_V620_DB_MIGRATION:-}" == "YES" ]] || {
    echo "BLOCKED=CONFIRM_V620_DB_MIGRATION_must_equal_YES" >&2
    exit 1
  }
  [[ "${RESTORE_DRILL_EVIDENCE_APPROVED:-}" == "YES" ]] || {
    echo "BLOCKED=RESTORE_DRILL_EVIDENCE_APPROVED_must_equal_YES" >&2
    exit 1
  }
  (cd "$API" && npm ci && npm run check && npm test)
  (cd "$API" && npm run migrate-db)
  (cd "$API" && npm run check-db:runtime-boundary)
  echo "DATABASE_MIGRATION_EXECUTED=true"
}

case "${1:-help}" in
  validate-source) validate_source ;;
  validate-full) validate_full ;;
  plan) plan ;;
  show-plan) show_plan ;;
  apply-plan) apply_plan ;;
  migrate-db) migrate_db ;;
  *)
    cat <<USAGE
Usage: $0 <command>

Commands:
  validate-source  Static and dependency-free source validation only
  validate-full    Node 24, dependencies, Terraform and complete local gates
  plan             Create an exact Terraform plan (requires TFVARS_FILE)
  show-plan        Display the saved plan and SHA-256
  apply-plan       Apply only the exact approved plan (double confirmation)
  migrate-db       Apply the additive V6.2 DB migration after restore approval
USAGE
    ;;
esac
