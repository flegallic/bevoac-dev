#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

grep -q 'SCAN_RESULT_RETENTION_DAYS_STANDARD' retention-job.tf || { echo '[ERROR] Missing standard retention env.' >&2; exit 1; }
grep -q 'SCAN_RESULT_RETENTION_DAYS_BUSINESS' retention-job.tf || { echo '[ERROR] Missing business retention env.' >&2; exit 1; }
grep -q 'SCAN_RESULT_RETENTION_DAYS_PAYG' retention-job.tf || { echo '[ERROR] Missing payg retention env.' >&2; exit 1; }
grep -q 'retention_done_days_standard' variables.tf || { echo '[ERROR] Missing retention_done_days_standard variable.' >&2; exit 1; }
grep -q 'retention_done_days_business' variables.tf || { echo '[ERROR] Missing retention_done_days_business variable.' >&2; exit 1; }
grep -q 'retention_done_days_payg' variables.tf || { echo '[ERROR] Missing retention_done_days_payg variable.' >&2; exit 1; }
echo '[OK] Plan-based retention variables and retention-job env are present.'
