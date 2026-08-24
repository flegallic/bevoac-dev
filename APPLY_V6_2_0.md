# Bevoac V6.2.0 — controlled application procedure

## Rule

Do not apply individual historical patches. Use this complete V6.2 candidate as one source baseline, then execute its gates in order.

## 1. Source verification

```bash
./validate_release.sh --structure-only
bash scripts/ci/source-security-gate.sh
bash scripts/release/test_v6_2_0_local.sh
```

## 2. Supported full validation

Run on a clean branch with Node.js 24, Terraform and network access to the dependency registries:

```bash
./validate_release.sh --full
```

GitHub Actions must also pass every job in `.github/workflows/bevoac-enterprise-gates.yml`.

## 3. PostgreSQL migration gate

Before production migration:

- complete a backup/restore proof;
- run the PostgreSQL 16 ephemeral integration gate;
- review migration `202608030001_v620_request_integrity_worker_resilience.sql`;
- confirm the migration is additive;
- record the Change Record.

The migration command is intentionally guarded by the release controller:

```bash
CONFIRM_V620_DB_MIGRATION=YES \
  bash scripts/release/release_v6_2_0.sh migrate-db
```

## 4. Terraform plan only

Prepare a reviewed tfvars file derived from:

```text
bevoac-iac-enterprise/release/v6.2.0-controlled-production.tfvars.example
```

Then:

```bash
TFVARS_FILE=/absolute/path/to/v6.2.0.tfvars \
  bash scripts/release/release_v6_2_0.sh plan
```

The controller saves the exact plan and its SHA-256. Do not apply a different plan.

## 5. Apply exact approved plan

Only after review and approval:

```bash
CONFIRM_V620_TERRAFORM_APPLY=YES \
EXPECTED_PLAN_SHA256=<approved-sha256> \
  bash scripts/release/release_v6_2_0.sh apply-plan
```

## 6. Runtime release

Build and promote immutable API, worker and demo-frontend images through CI. Record digests. Deploy a new revision without deleting the accepted V6.1.3 rollback revision.

Validate:

- direct liveness/readiness;
- APIM request succeeds;
- direct backend business request fails;
- API-key tenant isolation;
- scan creation and idempotency;
- worker processing;
- JSON/PDF;
- billing/outbox;
- backlog/DLQ;
- alerts and logs.

## 7. Production acceptance

Complete:

- notification test;
- restore drill and measured RPO/RTO;
- secret rotation;
- Service Bus local authentication disabled;
- load test;
- security review/pentest;
- real client tenant acceptance;
- rollback rehearsal;
- evidence pack.

## Forbidden shortcuts

- do not apply PR-00A separately;
- do not move or rewrite the V6.1.3 tag;
- do not run the example tfvars unchanged;
- do not apply an unhashed or unreviewed plan;
- do not disable SAS before Managed Identity smoke tests;
- do not claim production acceptance from source validation alone;
- do not start AWS implementation before V6.2 blocking gates are closed.
