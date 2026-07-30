#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$ROOT/scripts/release/validate_v6_1_3.py" --repo "$ROOT" "$@"
