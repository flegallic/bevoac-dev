#!/usr/bin/env bash

# Bevoac V6.2.0 R2.3 - local Terraform syntax and configuration qualification
#
# Works only in a disposable copy. It performs no Azure CLI command, no
# Terraform plan/apply, no backend initialization and no production access.

set -Eeuo pipefail

SOURCE="${SOURCE:-$HOME/Desktop/DOTCLOUD/development/bevoac-v6.2.0-r2.3-final}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="${WORK:-$HOME/Desktop/DOTCLOUD/development/bevoac-v6.2.0-r2.3-terraform-qualification-$STAMP}"
EVIDENCE="${EVIDENCE:-$HOME/Downloads/Bevoac_V6.2.0_R2.3_Terraform_Qualification_$STAMP}"
LOG="$EVIDENCE/qualification.log"
IAC_REL="bevoac-iac-enterprise"
IAC="$WORK/$IAC_REL"

mkdir -p "$EVIDENCE" || {
  echo "TERRAFORM_QUALIFICATION_OK=false"
  echo "FAILURE=cannot_create_evidence_directory:$EVIDENCE"
  exit 10
}

log() {
  printf '%s\n' "$*" | tee -a "$LOG"
}

make_evidence_zip() {
  parent="$(dirname "$EVIDENCE")"
  base="$(basename "$EVIDENCE")"
  (
    cd "$parent" || exit 1
    /usr/bin/zip -qr "$EVIDENCE.zip" "$base"
  ) >/dev/null 2>&1
}

cleanup_work() {
  if [ -d "$WORK" ]; then
    rm -rf "$WORK"
  fi
}

fail() {
  code="$1"
  shift
  reason="$*"
  log "TERRAFORM_QUALIFICATION_OK=false"
  log "FAILURE=$reason"
  log "EXIT_CODE=$code"
  if make_evidence_zip; then
    log "FAILURE_EVIDENCE_ZIP=$EVIDENCE.zip"
  else
    log "FAILURE_EVIDENCE_ZIP_CREATION=false"
  fi
  cleanup_work
  exit "$code"
}

run() {
  log ">>> $*"
  set +e
  "$@" 2>&1 | tee -a "$LOG"
  rc=${PIPESTATUS[0]}
  set -e
  if [ "$rc" -ne 0 ]; then
    fail "$rc" "command_failed:$*"
  fi
}

trap cleanup_work EXIT HUP INT TERM

log "QUALIFICATION_PHASE=TERRAFORM_FMT_INIT_VALIDATE"
log "SOURCE_REVISION=R2.3"
log "SOURCE=$SOURCE"
log "WORK=$WORK"
log "EVIDENCE=$EVIDENCE"
log "SOURCE_PATCHING=none"
log "AZURE_CLI_COMMANDS=none"
log "TERRAFORM_BACKEND_INITIALIZATION=false"
log "TERRAFORM_PLAN_EXECUTED=false"
log "TERRAFORM_APPLY_EXECUTED=false"
log "POSTGRESQL_PRODUCTION_CONNECTION=none"

[ -d "$SOURCE" ] || fail 11 "source_not_found:$SOURCE"
[ ! -e "$WORK" ] || fail 12 "work_directory_already_exists:$WORK"
[ -x "$SOURCE/VERIFY_SOURCE_PACKAGE.sh" ] || fail 13 "source_verifier_not_executable"

TERRAFORM_BIN="$(command -v terraform 2>/dev/null || true)"
[ -n "$TERRAFORM_BIN" ] && [ -x "$TERRAFORM_BIN" ] || fail 14 "terraform_not_found"

TF_VERSION="$($TERRAFORM_BIN version -json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["terraform_version"])' 2>/dev/null || true)"
log "TERRAFORM_SELECTED=$TERRAFORM_BIN"
log "TERRAFORM_VERSION=$TF_VERSION"
[ "$TF_VERSION" = "1.14.7" ] || fail 15 "terraform_version_must_be_1.14.7:$TF_VERSION"

run bash "$SOURCE/VERIFY_SOURCE_PACKAGE.sh"
run /usr/bin/ditto "$SOURCE" "$WORK"
run bash "$WORK/VERIFY_SOURCE_PACKAGE.sh"

[ -d "$IAC" ] || fail 16 "iac_directory_not_found:$IAC"

(
  cd "$WORK" || exit 1
  find "$IAC_REL" -maxdepth 1 -type f \( -name '*.tf' -o -name '.terraform.lock.hcl' \) -print0 \
    | sort -z \
    | xargs -0 shasum -a 256
) > "$EVIDENCE/terraform-source-before.sha256" || fail 17 "cannot_hash_terraform_source_before"

export TF_IN_AUTOMATION=1
export CHECKPOINT_DISABLE=1

run "$TERRAFORM_BIN" -chdir="$IAC" fmt -check -recursive -diff
log "TERRAFORM_FMT_CHECK_OK=true"

run "$TERRAFORM_BIN" -chdir="$IAC" init \
  -backend=false \
  -input=false \
  -lockfile=readonly \
  -no-color
log "TERRAFORM_INIT_BACKEND_FALSE_OK=true"

run "$TERRAFORM_BIN" -chdir="$IAC" providers
run "$TERRAFORM_BIN" -chdir="$IAC" validate -no-color
log "TERRAFORM_VALIDATE_OK=true"

(
  cd "$WORK" || exit 1
  find "$IAC_REL" -maxdepth 1 -type f \( -name '*.tf' -o -name '.terraform.lock.hcl' \) -print0 \
    | sort -z \
    | xargs -0 shasum -a 256
) > "$EVIDENCE/terraform-source-after.sha256" || fail 18 "cannot_hash_terraform_source_after"

if ! cmp -s "$EVIDENCE/terraform-source-before.sha256" "$EVIDENCE/terraform-source-after.sha256"; then
  diff -u \
    "$EVIDENCE/terraform-source-before.sha256" \
    "$EVIDENCE/terraform-source-after.sha256" \
    > "$EVIDENCE/terraform-source-diff.txt" 2>&1 || true
  fail 19 "terraform_source_or_lockfile_changed"
fi
log "TERRAFORM_SOURCE_AND_LOCKFILE_UNCHANGED=true"

rm -rf "$IAC/.terraform"
run bash "$WORK/VERIFY_SOURCE_PACKAGE.sh"
run bash "$SOURCE/VERIFY_SOURCE_PACKAGE.sh"

cat > "$EVIDENCE/QUALIFICATION_SUMMARY.txt" <<SUMMARY
QUALIFICATION_PHASE=TERRAFORM_FMT_INIT_VALIDATE
SOURCE_REVISION=R2.3
TERRAFORM_VERSION=$TF_VERSION
TERRAFORM_FMT_CHECK_OK=true
TERRAFORM_INIT_BACKEND_FALSE_OK=true
TERRAFORM_VALIDATE_OK=true
TERRAFORM_SOURCE_AND_LOCKFILE_UNCHANGED=true
SOURCE_BASELINE_UNCHANGED=true
AZURE_CONFIGURATION_MODIFIED=false
TERRAFORM_STATE_MODIFIED=false
TERRAFORM_PLAN_EXECUTED=false
TERRAFORM_APPLY_EXECUTED=false
POSTGRESQL_PRODUCTION_MUTATION_EXECUTED=false
TERRAFORM_QUALIFICATION_OK=true
SUMMARY
cat "$EVIDENCE/QUALIFICATION_SUMMARY.txt" | tee -a "$LOG"

make_evidence_zip || fail 20 "cannot_create_evidence_zip"
ZIP_SHA="$(shasum -a 256 "$EVIDENCE.zip" | awk '{print $1}')"
log "EVIDENCE_ZIP_SHA256=$ZIP_SHA"
log "EVIDENCE_ZIP=$EVIDENCE.zip"
log "TERRAFORM_QUALIFICATION_OK=true"

cleanup_work
trap - EXIT HUP INT TERM
