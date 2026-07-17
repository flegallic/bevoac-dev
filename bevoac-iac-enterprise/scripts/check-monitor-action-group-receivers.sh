#!/usr/bin/env bash
set -euo pipefail

: "${MONITOR_ACTION_GROUP_ID:?Set MONITOR_ACTION_GROUP_ID or run: export MONITOR_ACTION_GROUP_ID=$(terraform output -raw monitor_action_group_id)}"

az monitor action-group show \
  --ids "$MONITOR_ACTION_GROUP_ID" \
  --query "{name:name,enabled:enabled,emailReceivers:emailReceivers,smsReceivers:smsReceivers,webhookReceivers:webhookReceivers,azureFunctionReceivers:azureFunctionReceivers,logicAppReceivers:logicAppReceivers,armRoleReceivers:armRoleReceivers}" \
  -o json

python3 - <<'PY'
import json, os, subprocess, sys
cmd = [
    'az', 'monitor', 'action-group', 'show',
    '--ids', os.environ['MONITOR_ACTION_GROUP_ID'],
    '-o', 'json'
]
data = json.loads(subprocess.check_output(cmd, text=True))
receiver_fields = [
    'emailReceivers', 'smsReceivers', 'webhookReceivers',
    'azureFunctionReceivers', 'logicAppReceivers', 'armRoleReceivers'
]
count = sum(len(data.get(field) or []) for field in receiver_fields)
if count <= 0:
    print('[WARN] Action Group has no receivers. Alerts exist, but no notification target is configured.')
    sys.exit(2)
print(f'[OK] Action Group has {count} receiver(s).')
PY
