# Bevoac V6.1 Patch Notes — Production usability patch

## Scope

V6.1 is a non-breaking patch on top of V6.0. It addresses issues discovered during client/admin validation:

1. Historical scans completed before the V5/V6 billing finalization can appear as `DONE` with `billingState=RESERVED`.
2. Web scan evidence metadata can expose `executionStatus=UNKNOWN` even when the scan finished correctly.
3. V6 KPI objects are present in JSON but the PDF did not expose a dedicated `KPI Scorecard` section.
4. Azure Monitor metric alerts are active, but the Action Group may have no notification receiver.

## Design decisions

| Item | V6.1 decision | Safety property |
|---|---|---|
| Billing backfill | Add explicit script, dry-run by default | No data mutation without `--apply` |
| Web execution status | Set web module `status` and `executionStatus` to `SUCCESS` when scanner execution completes | No change to findings severity/status |
| PDF KPI Scorecard | Add section `1.6 KPI Scorecard` while preserving the historical PDF sections | Additive only |
| Action Group receiver | Add operational scripts to check/configure email receiver | No automatic Azure mutation during package apply |

## New commands

### Billing backfill dry-run

```bash
cd bevoac-api-enterprise
npm run backfill:billing:dry-run
```

### Billing backfill apply for historical completed scans

```bash
cd bevoac-api-enterprise
npm run backfill:billing -- --apply --before 2026-06-01
```

### Check Action Group receivers

```bash
cd bevoac-iac-enterprise
export MONITOR_ACTION_GROUP_ID="$(terraform output -raw monitor_action_group_id)"
bash scripts/check-monitor-action-group-receivers.sh
```

### Add an Action Group email receiver when there is no receiver

```bash
cd bevoac-iac-enterprise
export MONITOR_ACTION_GROUP_ID="$(terraform output -raw monitor_action_group_id)"
export MONITOR_ALERT_EMAIL="support@dotcloud.fr"
export MONITOR_ALERT_RECEIVER_NAME="bevoac-support-email"
bash scripts/ensure-monitor-action-group-email-receiver.sh
```

## Validation after applying V6.1

```bash
cd bevoac-api-enterprise
npm install
npm run check
npm test
npm run backfill:billing:dry-run

cd ../bevoac-worker-enterprise
npm install
npm run check
npm test

cd ../bevoac-iac-enterprise
terraform fmt -recursive
terraform init -backend=false
terraform validate
bash scripts/static-hardening-check.sh
export MONITOR_ACTION_GROUP_ID="$(terraform output -raw monitor_action_group_id)"
bash scripts/check-monitor-action-group-receivers.sh || true
```

## PDF validation

After a new V6.1 scan, regenerate a PDF and verify the historical sections plus KPI section:

```bash
curl -s -L "$API_BASE_URL/v1/scans/$SCAN_ID/pdf" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -o /tmp/bevoac-v6-1-report.pdf

pdftotext /tmp/bevoac-v6-1-report.pdf - | grep -E \
  "Executive Summary|KPI Scorecard|Module summary|Top risks|Remediation priorities|Control Matrix|Technical Evidence Appendix"
```
