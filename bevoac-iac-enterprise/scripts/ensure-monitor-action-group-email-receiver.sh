#!/usr/bin/env bash
set -euo pipefail

: "${MONITOR_ACTION_GROUP_ID:?Set MONITOR_ACTION_GROUP_ID or run: export MONITOR_ACTION_GROUP_ID=$(terraform output -raw monitor_action_group_id)}"
: "${MONITOR_ALERT_EMAIL:?Set MONITOR_ALERT_EMAIL, for example support@dotcloud.fr}"

RECEIVER_NAME="${MONITOR_ALERT_RECEIVER_NAME:-bevoac-support-email}"

ACTION_GROUP_JSON="$(az monitor action-group show --ids "$MONITOR_ACTION_GROUP_ID" -o json)"
ACTION_GROUP_NAME="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])' <<< "$ACTION_GROUP_JSON")"
RESOURCE_GROUP="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["resourceGroup"])' <<< "$ACTION_GROUP_JSON")"
SHORT_NAME="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("groupShortName") or "bevoac")' <<< "$ACTION_GROUP_JSON")"
RECEIVER_COUNT="$(ACTION_GROUP_JSON="$ACTION_GROUP_JSON" python3 - <<'PY'
import json, os
j=json.loads(os.environ['ACTION_GROUP_JSON'])
fields=['emailReceivers','smsReceivers','webhookReceivers','azureFunctionReceivers','logicAppReceivers','armRoleReceivers']
print(sum(len(j.get(f) or []) for f in fields))
PY
)"

if [ "$RECEIVER_COUNT" != "0" ] && [ "${ALLOW_REPLACE_ACTION_GROUP_RECEIVERS:-false}" != "true" ]; then
  echo "[ERROR] Action Group already has $RECEIVER_COUNT receiver(s). Refusing to overwrite." >&2
  echo "Set ALLOW_REPLACE_ACTION_GROUP_RECEIVERS=true only if you intentionally want to recreate the receiver set with the email receiver." >&2
  exit 1
fi

echo "[INFO] Updating Action Group $ACTION_GROUP_NAME in $RESOURCE_GROUP with email receiver $RECEIVER_NAME <$MONITOR_ALERT_EMAIL>."
az monitor action-group create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACTION_GROUP_NAME" \
  --short-name "$SHORT_NAME" \
  --action email "$RECEIVER_NAME" "$MONITOR_ALERT_EMAIL" \
  --output none

echo "[OK] Action Group email receiver configured."
az monitor action-group show \
  --ids "$MONITOR_ACTION_GROUP_ID" \
  --query "{name:name,enabled:enabled,emailReceivers:emailReceivers[].{name:name,email:emailAddress,status:status,useCommonAlertSchema:useCommonAlertSchema}}" \
  -o json
