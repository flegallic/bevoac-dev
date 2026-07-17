#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
RESOURCE_GROUP="${RESOURCE_GROUP:-$(terraform output -raw resource_group_name)}"
LOCATION="${LOCATION:-$(terraform output -raw resource_group_name >/dev/null 2>&1 && az group show --name "$RESOURCE_GROUP" --query location -o tsv)}"
POSTGRES_FQDN="${POSTGRES_FQDN:-$(terraform output -raw postgres_fqdn)}"
SOURCE_SERVER_NAME="${SOURCE_SERVER_NAME:-${POSTGRES_FQDN%%.*}}"
RESTORE_SERVER_NAME="${RESTORE_SERVER_NAME:-}"
RESTORE_TIME_UTC="${RESTORE_TIME_UTC:-}"

if [[ -z "$RESTORE_SERVER_NAME" || -z "$RESTORE_TIME_UTC" ]]; then
  cat >&2 <<USAGE
[ERROR] RESTORE_SERVER_NAME and RESTORE_TIME_UTC are required.
Example:
  export RESTORE_SERVER_NAME="${SOURCE_SERVER_NAME}-restore-$(date +%Y%m%d%H%M)"
  export RESTORE_TIME_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  bash scripts/postgres-restore-drill.sh
USAGE
  exit 1
fi

echo "RESOURCE_GROUP=$RESOURCE_GROUP"
echo "LOCATION=$LOCATION"
echo "SOURCE_SERVER_NAME=$SOURCE_SERVER_NAME"
echo "RESTORE_SERVER_NAME=$RESTORE_SERVER_NAME"
echo "RESTORE_TIME_UTC=$RESTORE_TIME_UTC"

echo "[INFO] Starting Azure PostgreSQL Flexible Server point-in-time restore drill..."
az postgres flexible-server restore \
  --resource-group "$RESOURCE_GROUP" \
  --name "$RESTORE_SERVER_NAME" \
  --source-server "$SOURCE_SERVER_NAME" \
  --restore-time "$RESTORE_TIME_UTC" \
  --location "$LOCATION" \
  --yes

echo "[INFO] Restore command completed. Validating restored server..."
az postgres flexible-server show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$RESTORE_SERVER_NAME" \
  --query "{name:name,state:state,version:version,fullyQualifiedDomainName:fullyQualifiedDomainName}" \
  -o json

cat <<NEXT
[OK] Restore drill created server: $RESTORE_SERVER_NAME
Next steps:
  1. Connect from an authorized network.
  2. Run read-only sanity SQL against schema_migrations, tenants, scans and scan_results.
  3. Delete the restored server after evidence capture if this was only a drill:
     az postgres flexible-server delete --resource-group "$RESOURCE_GROUP" --name "$RESTORE_SERVER_NAME" --yes
NEXT
