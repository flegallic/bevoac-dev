#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_DIR="$(cd "$API_DIR/.." && pwd)"

IAC_SCRIPT=""
for candidate in \
  "$PACKAGE_DIR/bevoac-iac-entreprise/scripts/generate-api-env-local.sh" \
  "$PACKAGE_DIR/bevoac-iac-enterprise/scripts/generate-api-env-local.sh"; do
  if [ -x "$candidate" ]; then
    IAC_SCRIPT="$candidate"
    break
  fi
done

if [ -z "$IAC_SCRIPT" ]; then
  echo "ERROR: IAC generate-api-env-local.sh script not found or not executable." >&2
  exit 1
fi

exec "$IAC_SCRIPT" "$@"
