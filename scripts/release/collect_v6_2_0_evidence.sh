#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${V620_EVIDENCE_DIR:-$ROOT/artifacts/v6.2.0-evidence}"
mkdir -p "$OUT"

capture() {
  local name="$1"
  shift
  {
    echo "COMMAND=$*"
    echo "TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    "$@"
  } > "$OUT/$name.txt" 2>&1 || true
}

capture source-version git -C "$ROOT" rev-parse HEAD
capture source-status git -C "$ROOT" status --short
capture release-version cat "$ROOT/RELEASE_VERSION"
capture static-validator "$ROOT/validate_release.sh" --structure-only
capture source-security bash "$ROOT/scripts/ci/source-security-gate.sh"
capture iac-hardening bash "$ROOT/bevoac-iac-enterprise/scripts/static-hardening-check.sh"

find "$OUT" -type f -maxdepth 1 -print0 \
  | sort -z \
  | xargs -0 shasum -a 256 > "$OUT/SHA256SUMS"

cat > "$OUT/EVIDENCE_STATUS.md" <<STATUS
# V6.2.0 evidence collection status

This collection is source/static only unless external CI/live artifacts are copied here.

Still required before production GO:

- GitHub Actions complete;
- PostgreSQL 16/RLS integration;
- Terraform validation and approved plan;
- Azure diagnostics and notification test;
- APIM boundary live smoke;
- Service Bus local-auth retirement;
- secret rotation;
- restore drill;
- load test;
- security review/pentest;
- client tenant acceptance;
- rollback rehearsal.
STATUS

echo "EVIDENCE_COLLECTION_COMPLETED=true"
echo "AZURE_CONFIGURATION_MODIFIED=false"
echo "POSTGRESQL_MUTATION_EXECUTED=false"
echo "EVIDENCE_DIR=$OUT"
