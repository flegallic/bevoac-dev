# Bevoac V6.1.3 Operations Hotfix 2

## Scope

Correct the staged Terraform transition for two secret-scoped Key Vault role assignments that remain required by rollback-compatible legacy revisions during the workload rollout.

## Changes

- restore `api_legacy_admin_secret_reader` behind a dedicated workload/finalization switch;
- restore `worker_servicebus_secret_reader` behind the legacy Service Bus secret lifecycle switch;
- add Terraform `moved` blocks so the existing production assignments move to indexed addresses without recreation;
- retain both assignments in the workload phase and remove them only in the security-finalize phase;
- extend the security-plan deletion allowlist and final smoke checks;
- extend static IaC gates to prevent this transition regression.

## Impact

- no application runtime code change;
- no API or worker image rebuild;
- no PostgreSQL migration;
- no Azure change until a reviewed Terraform plan is explicitly applied.
