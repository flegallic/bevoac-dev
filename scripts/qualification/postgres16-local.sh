#!/usr/bin/env bash

# Bevoac V6.2.0 R2.3 - PostgreSQL 16 local enterprise qualification
#
# Runs the repository enterprise PostgreSQL gate against a disposable
# postgres:16-alpine container. The source is copied to a qualification
# workspace and is never patched. No Azure, Terraform, or production database
# command is executed.

set -Eeuo pipefail

SOURCE="${SOURCE:-$HOME/Desktop/DOTCLOUD/development/bevoac-v6.2.0-r2.3-final}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="${WORK:-$HOME/Desktop/DOTCLOUD/development/bevoac-v6.2.0-r2.3-postgres16-qualification-$STAMP}"
EVIDENCE="${EVIDENCE:-$HOME/Downloads/Bevoac_V6.2.0_R2.3_Postgres16_Qualification_$STAMP}"
LOG="$EVIDENCE/qualification.log"
IMAGE_REF="postgres:16-alpine"
CONTAINER=""
TEMP_DOCKER_CONFIG=""
ORIGINAL_PATH="${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"
ORIGINAL_DOCKER_HOST="${DOCKER_HOST:-}"

mkdir -p "$EVIDENCE" || {
  echo "POSTGRES16_QUALIFICATION_OK=false"
  echo "FAILURE=cannot_create_evidence_directory:$EVIDENCE"
  exit 10
}

log() {
  printf '%s\n' "$*" | tee -a "$LOG"
}

locate_executable() {
  command_name="$1"
  shift
  found="$(command -v "$command_name" 2>/dev/null || true)"
  if [ -n "$found" ] && [ -x "$found" ]; then
    printf '%s\n' "$found"
    return 0
  fi
  for candidate in "$@"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

cleanup() {
  if [ -n "$CONTAINER" ] && [ -n "${DOCKER_BIN:-}" ]; then
    "$DOCKER_BIN" logs "$CONTAINER" >"$EVIDENCE/postgres-container.log" 2>&1 || true
    "$DOCKER_BIN" inspect "$CONTAINER" >"$EVIDENCE/postgres-container-inspect.json" 2>/dev/null || true
    "$DOCKER_BIN" rm -f "$CONTAINER" >/dev/null 2>&1 || true
    CONTAINER=""
  fi
  if [ -n "$TEMP_DOCKER_CONFIG" ] && [ -d "$TEMP_DOCKER_CONFIG" ]; then
    rm -rf "$TEMP_DOCKER_CONFIG"
    TEMP_DOCKER_CONFIG=""
  fi
}

make_evidence_zip() {
  parent="$(dirname "$EVIDENCE")"
  base="$(basename "$EVIDENCE")"
  (
    cd "$parent" || exit 1
    /usr/bin/zip -qr "$EVIDENCE.zip" "$base"
  ) >/dev/null 2>&1
}

fail() {
  code="$1"
  shift
  reason="$*"
  log "POSTGRES16_QUALIFICATION_OK=false"
  log "FAILURE=$reason"
  log "EXIT_CODE=$code"
  cleanup
  if make_evidence_zip; then
    log "FAILURE_EVIDENCE_ZIP=$EVIDENCE.zip"
  else
    log "FAILURE_EVIDENCE_ZIP_CREATION=false"
  fi
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

trap cleanup EXIT HUP INT TERM

log "QUALIFICATION_PHASE=POSTGRES16_ENTERPRISE_GATE"
log "SOURCE_REVISION=R2.3"
log "SOURCE=$SOURCE"
log "WORK=$WORK"
log "EVIDENCE=$EVIDENCE"
log "SOURCE_PATCHING=none"
log "AZURE_COMMANDS=none"
log "TERRAFORM_COMMANDS=none"
log "POSTGRESQL_PRODUCTION_CONNECTION=none"

command -v brew >/dev/null 2>&1 || fail 11 "homebrew_not_found"
NODE24_PREFIX="$(brew --prefix node@24 2>/dev/null || true)"
[ -n "$NODE24_PREFIX" ] || fail 12 "node24_homebrew_prefix_not_found"
[ -x "$NODE24_PREFIX/bin/node" ] || fail 13 "node24_binary_not_found:$NODE24_PREFIX/bin/node"
[ -x "$NODE24_PREFIX/bin/npm" ] || fail 14 "npm_binary_not_found:$NODE24_PREFIX/bin/npm"

# npm invokes /usr/bin/env node. Node 24 must therefore be first in PATH, while
# the original PATH and Docker Desktop helper locations remain available.
PATH="$NODE24_PREFIX/bin:$ORIGINAL_PATH:/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
hash -r

NODE_SELECTED="$(command -v node 2>/dev/null || true)"
NPM_SELECTED="$(command -v npm 2>/dev/null || true)"
NODE_VERSION="$(node --version 2>/dev/null || true)"
NPM_VERSION="$(npm --version 2>/dev/null || true)"

log "NODE_SELECTED=$NODE_SELECTED"
log "NPM_SELECTED=$NPM_SELECTED"
log "NODE_VERSION=$NODE_VERSION"
log "NPM_VERSION=$NPM_VERSION"

case "$NODE_VERSION" in
  v24.*) ;;
  *) fail 15 "node_version_is_not_24:$NODE_VERSION" ;;
esac
case "$NPM_VERSION" in
  11.*) ;;
  *) fail 16 "npm_version_is_not_11:$NPM_VERSION" ;;
esac

DOCKER_BIN="$(locate_executable docker \
  /usr/local/bin/docker \
  /opt/homebrew/bin/docker \
  "$HOME/.docker/bin/docker" \
  /Applications/Docker.app/Contents/Resources/bin/docker || true)"
[ -n "$DOCKER_BIN" ] || fail 17 "docker_cli_not_found"
"$DOCKER_BIN" info >/dev/null 2>&1 || fail 18 "docker_engine_not_available"

DOCKER_CONTEXT="$("$DOCKER_BIN" context show 2>/dev/null || true)"
DOCKER_ENDPOINT=""
if [ -n "$DOCKER_CONTEXT" ]; then
  DOCKER_ENDPOINT="$("$DOCKER_BIN" context inspect "$DOCKER_CONTEXT" --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
fi

PSQL_BIN="$(locate_executable psql \
  /opt/homebrew/bin/psql \
  /usr/local/bin/psql \
  "$(brew --prefix libpq 2>/dev/null || true)/bin/psql" || true)"
[ -n "$PSQL_BIN" ] || fail 19 "psql_not_found"

log "DOCKER_SELECTED=$DOCKER_BIN"
log "DOCKER_CONTEXT=$DOCKER_CONTEXT"
log "DOCKER_ENDPOINT=$DOCKER_ENDPOINT"
log "DOCKER_VERSION=$("$DOCKER_BIN" version --format '{{.Server.Version}}' 2>/dev/null || true)"
log "PSQL_SELECTED=$PSQL_BIN"
log "PSQL_VERSION=$("$PSQL_BIN" --version 2>/dev/null || true)"

[ -d "$SOURCE" ] || fail 20 "source_not_found:$SOURCE"
[ ! -e "$WORK" ] || fail 21 "work_directory_already_exists:$WORK"

run bash "$SOURCE/VERIFY_SOURCE_PACKAGE.sh"
run /usr/bin/ditto "$SOURCE" "$WORK"
run bash "$WORK/VERIFY_SOURCE_PACKAGE.sh"

(
  cd "$WORK" || exit 1
  shasum -a 256 \
    bevoac-api-enterprise/package.json \
    bevoac-api-enterprise/package-lock.json \
    bevoac-worker-enterprise/package.json \
    bevoac-worker-enterprise/package-lock.json
) >"$EVIDENCE/package-files-before.sha256" || fail 22 "cannot_hash_package_files_before"

run bash -c 'cd "$1" && npm ci' bash "$WORK/bevoac-api-enterprise"
run bash -c 'cd "$1" && npm ci' bash "$WORK/bevoac-worker-enterprise"

if "$DOCKER_BIN" image inspect "$IMAGE_REF" >/dev/null 2>&1; then
  PULL_MODE="local-cache"
else
  NORMAL_PULL_LOG="$EVIDENCE/docker-pull-normal.log"
  set +e
  "$DOCKER_BIN" pull "$IMAGE_REF" >"$NORMAL_PULL_LOG" 2>&1
  pull_rc=$?
  set -e
  if [ "$pull_rc" -eq 0 ]; then
    cat "$NORMAL_PULL_LOG" | tee -a "$LOG"
    PULL_MODE="desktop-config"
  else
    cat "$NORMAL_PULL_LOG" | tee -a "$LOG"
    log "DOCKER_CREDENTIAL_FALLBACK=anonymous-public-image"
    TEMP_DOCKER_CONFIG="$(mktemp -d "${TMPDIR:-/tmp}/bevoac-docker-config.XXXXXX")" || fail 23 "cannot_create_isolated_docker_config"
    printf '{"auths":{}}\n' >"$TEMP_DOCKER_CONFIG/config.json"
    FALLBACK_PULL_LOG="$EVIDENCE/docker-pull-anonymous.log"
    set +e
    if [ -n "$DOCKER_ENDPOINT" ]; then
      DOCKER_CONFIG="$TEMP_DOCKER_CONFIG" DOCKER_HOST="$DOCKER_ENDPOINT" \
        "$DOCKER_BIN" pull "$IMAGE_REF" >"$FALLBACK_PULL_LOG" 2>&1
    elif [ -n "$ORIGINAL_DOCKER_HOST" ]; then
      DOCKER_CONFIG="$TEMP_DOCKER_CONFIG" DOCKER_HOST="$ORIGINAL_DOCKER_HOST" \
        "$DOCKER_BIN" pull "$IMAGE_REF" >"$FALLBACK_PULL_LOG" 2>&1
    else
      DOCKER_CONFIG="$TEMP_DOCKER_CONFIG" \
        "$DOCKER_BIN" pull "$IMAGE_REF" >"$FALLBACK_PULL_LOG" 2>&1
    fi
    fallback_rc=$?
    set -e
    cat "$FALLBACK_PULL_LOG" | tee -a "$LOG"
    [ "$fallback_rc" -eq 0 ] || fail 24 "cannot_pull_public_postgres_image"
    PULL_MODE="anonymous-isolated-config"
  fi
fi
log "DOCKER_PULL_MODE=$PULL_MODE"

IMAGE_ID="$("$DOCKER_BIN" image inspect "$IMAGE_REF" --format '{{.Id}}' 2>/dev/null || true)"
IMAGE_DIGEST="$("$DOCKER_BIN" image inspect "$IMAGE_REF" --format '{{join .RepoDigests ","}}' 2>/dev/null || true)"
[ -n "$IMAGE_ID" ] || fail 25 "postgres_image_id_missing"
log "POSTGRES_IMAGE_ID=$IMAGE_ID"
log "POSTGRES_IMAGE_DIGEST=$IMAGE_DIGEST"

CONTAINER="bevoac-r23-pg16-${STAMP}-$$"
container_id="$("$DOCKER_BIN" run -d \
  --name "$CONTAINER" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 127.0.0.1::5432 \
  "$IMAGE_ID" 2>>"$LOG")" || fail 26 "cannot_start_postgres16_container"
log "POSTGRES_CONTAINER=$CONTAINER"
log "POSTGRES_CONTAINER_ID=$container_id"

ready=false
attempt=0
while [ "$attempt" -lt 90 ]; do
  if "$DOCKER_BIN" exec "$CONTAINER" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
[ "$ready" = true ] || fail 27 "postgres16_container_not_ready"

PGPORT="$("$DOCKER_BIN" inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$CONTAINER" 2>/dev/null || true)"
case "$PGPORT" in
  ''|*[!0-9]*) fail 28 "invalid_postgres_host_port:$PGPORT" ;;
esac
log "PGHOST=127.0.0.1"
log "PGPORT=$PGPORT"

SERVER_VERSION="$(PGPASSWORD=postgres "$PSQL_BIN" -X -A -t \
  -h 127.0.0.1 -p "$PGPORT" -U postgres -d postgres \
  -c 'SHOW server_version;' 2>>"$LOG" | tr -d '[:space:]')" || fail 29 "cannot_read_postgres_server_version"
log "POSTGRES_SERVER_VERSION=$SERVER_VERSION"
case "$SERVER_VERSION" in
  16.*) ;;
  *) fail 30 "postgres_server_is_not_version_16:$SERVER_VERSION" ;;
esac

run env \
  PGHOST=127.0.0.1 \
  PGPORT="$PGPORT" \
  POSTGRES_USER=postgres \
  POSTGRES_PASSWORD=postgres \
  CI_DATABASE=bevoac_ci \
  bash -c 'cd "$1" && bash scripts/ci/postgres-enterprise-gate.sh' bash "$WORK"

PGPASSWORD=ci_bevoacadmin_password "$PSQL_BIN" -X -A -F '|' \
  -h 127.0.0.1 -p "$PGPORT" -U bevoacadmin -d bevoac_ci \
  -c "SELECT current_setting('server_version') AS server_version, (SELECT count(*) FROM public.schema_migrations) AS migrations, (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS policies;" \
  >"$EVIDENCE/postgres-gate-summary.txt" 2>>"$LOG" || fail 31 "cannot_capture_postgres_gate_summary"

(
  cd "$WORK" || exit 1
  shasum -a 256 \
    bevoac-api-enterprise/package.json \
    bevoac-api-enterprise/package-lock.json \
    bevoac-worker-enterprise/package.json \
    bevoac-worker-enterprise/package-lock.json
) >"$EVIDENCE/package-files-after.sha256" || fail 32 "cannot_hash_package_files_after"

if ! cmp -s "$EVIDENCE/package-files-before.sha256" "$EVIDENCE/package-files-after.sha256"; then
  diff -u "$EVIDENCE/package-files-before.sha256" "$EVIDENCE/package-files-after.sha256" \
    >"$EVIDENCE/package-files-hash-diff.txt" 2>&1 || true
  fail 33 "package_or_lockfile_changed"
fi
log "PACKAGE_AND_LOCKFILES_UNCHANGED=true"

rm -rf \
  "$WORK/bevoac-api-enterprise/node_modules" \
  "$WORK/bevoac-worker-enterprise/node_modules"

run bash "$WORK/VERIFY_SOURCE_PACKAGE.sh"
run bash "$SOURCE/VERIFY_SOURCE_PACKAGE.sh"

cleanup

cat >"$EVIDENCE/QUALIFICATION_SUMMARY.txt" <<EOF
QUALIFICATION_PHASE=POSTGRES16_ENTERPRISE_GATE
SOURCE_REVISION=R2.3
POSTGRES_SERVER_VERSION=$SERVER_VERSION
POSTGRES_ENTERPRISE_GATE_OK=true
PACKAGE_AND_LOCKFILES_UNCHANGED=true
SOURCE_BASELINE_UNCHANGED=true
AZURE_CONFIGURATION_MODIFIED=false
TERRAFORM_STATE_MODIFIED=false
POSTGRESQL_PRODUCTION_MUTATION_EXECUTED=false
POSTGRES16_QUALIFICATION_OK=true
EOF

cat "$EVIDENCE/QUALIFICATION_SUMMARY.txt" | tee -a "$LOG"

if ! make_evidence_zip; then
  fail 34 "cannot_create_evidence_zip"
fi

ZIP_SHA256="$(shasum -a 256 "$EVIDENCE.zip" | awk '{print $1}')"
log "EVIDENCE_ZIP_SHA256=$ZIP_SHA256"
log "EVIDENCE_ZIP=$EVIDENCE.zip"
log "POSTGRES16_QUALIFICATION_OK=true"

rm -rf "$WORK"
exit 0
