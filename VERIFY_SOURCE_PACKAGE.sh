#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$ROOT/SOURCE_SHA256SUMS"

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo "SOURCE_PACKAGE_VERIFY_ERROR=no SHA-256 command available" >&2
    return 1
  fi
}

if [[ ! -f "$MANIFEST" ]]; then
  echo "SOURCE_PACKAGE_VERIFY_ERROR=missing SOURCE_SHA256SUMS" >&2
  exit 1
fi

cd "$ROOT"
failed=0
checked=0

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  expected="${line%%  *}"
  relative="${line#*  }"
  if [[ ! -f "$relative" ]]; then
    echo "SOURCE_PACKAGE_MISSING=$relative" >&2
    failed=1
    continue
  fi
  actual="$(sha256_file "$relative")"
  if [[ "$actual" != "$expected" ]]; then
    echo "SOURCE_PACKAGE_MISMATCH=$relative" >&2
    failed=1
  fi
  checked=$((checked + 1))
done < "$MANIFEST"

if [[ "$failed" -ne 0 ]]; then
  echo "SOURCE_PACKAGE_VERIFICATION_OK=false" >&2
  exit 2
fi

echo "SOURCE_PACKAGE_FILES_VERIFIED=$checked"
echo "SOURCE_PACKAGE_VERIFICATION_OK=true"
