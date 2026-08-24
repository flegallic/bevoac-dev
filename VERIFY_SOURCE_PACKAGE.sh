#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MANIFEST="SOURCE_SHA256SUMS"

if [ ! -f "$MANIFEST" ]; then
  echo "SOURCE_PACKAGE_VERIFICATION_OK=false"
  echo "FAILURE=manifest_missing"
  exit 2
fi

TMP_EXPECTED="$(mktemp)"
TMP_ACTUAL="$(mktemp)"

cleanup() {
  rm -f "$TMP_EXPECTED" "$TMP_ACTUAL"
}
trap cleanup EXIT

# Canonical release inventory:
# every Git-tracked file except the manifest itself.
git ls-files -z |
  python3 -c '
import sys
items = [p.decode("utf-8") for p in sys.stdin.buffer.read().split(b"\0") if p]
for p in sorted(items):
    if p != "SOURCE_SHA256SUMS":
        print(p)
' > "$TMP_EXPECTED"

awk '{$1=""; sub(/^ /,""); print}' "$MANIFEST" | LC_ALL=C sort > "$TMP_ACTUAL"

if ! cmp -s "$TMP_EXPECTED" "$TMP_ACTUAL"; then
  echo "SOURCE_PACKAGE_INVENTORY_OK=false"

  comm -23 "$TMP_EXPECTED" "$TMP_ACTUAL" |
    while IFS= read -r path; do
      [ -n "$path" ] && echo "SOURCE_PACKAGE_MANIFEST_MISSING=$path"
    done

  comm -13 "$TMP_EXPECTED" "$TMP_ACTUAL" |
    while IFS= read -r path; do
      [ -n "$path" ] && echo "SOURCE_PACKAGE_MANIFEST_EXTRA=$path"
    done

  echo "SOURCE_PACKAGE_VERIFICATION_OK=false"
  exit 3
fi

echo "SOURCE_PACKAGE_INVENTORY_OK=true"

FAIL=0
COUNT=0

while IFS= read -r line; do
  expected_hash="${line%%  *}"
  path="${line#*  }"

  if [ ! -f "$path" ]; then
    echo "SOURCE_PACKAGE_MISSING=$path"
    FAIL=1
    continue
  fi

  actual_hash="$(shasum -a 256 "$path" | awk '{print $1}')"

  if [ "$actual_hash" != "$expected_hash" ]; then
    echo "SOURCE_PACKAGE_MISMATCH=$path"
    FAIL=1
  fi

  COUNT=$((COUNT + 1))
done < "$MANIFEST"

echo "SOURCE_PACKAGE_FILES_VERIFIED=$COUNT"

if [ "$FAIL" -ne 0 ]; then
  echo "SOURCE_PACKAGE_VERIFICATION_OK=false"
  exit 4
fi

echo "SOURCE_PACKAGE_VERIFICATION_OK=true"
