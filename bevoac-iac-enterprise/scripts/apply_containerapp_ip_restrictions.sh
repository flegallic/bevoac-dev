#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <resource-group> <container-app-name> <cidr1> [cidr2 ...]"
  exit 1
fi

RESOURCE_GROUP="$1"
APP_NAME="$2"
shift 2

for CIDR in "$@"; do
  SAFE_NAME="allow-$(echo "$CIDR" | tr './' '--')"
  az containerapp ingress access-restriction set     --resource-group "$RESOURCE_GROUP"     --name "$APP_NAME"     --rule-name "$SAFE_NAME"     --ip-address "$CIDR"     --description "Allowed client or reseller range"     --action Allow
  echo "Applied allow rule for $CIDR"
done
