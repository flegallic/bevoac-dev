# Bevoac V6.1.3 — Enterprise release baseline

Bevoac is an Azure-first B2B SaaS control plane for security-audit orchestration. This repository contains the public API, asynchronous worker, transactional outbox publisher, retention job, isolated administration API, Azure infrastructure as code, database migrations, security gates and the canonical operations documentation.

## Release scope

V6.1.3 turns the V6.1.2 runtime-role model into a deployable release without changing the public `/v1` API or the active `scan.requested` contract.

Main outcomes:

- PostgreSQL identity per workload: `bevoac_api`, `bevoac_worker`, `bevoac_outbox`, `bevoac_retention`, `bevoac_admin_api` and `bevoac_operator`;
- forced row-level security bound to the real PostgreSQL `session_user`;
- no mutable `app.service_context` runtime path;
- public API separated from Service Bus publication;
- dedicated Managed Identities and secret-scoped Key Vault access;
- Managed Identity authentication for Service Bus sender, receiver and queue scaler;
- staged migration followed by explicit security finalization;
- PostgreSQL 16 ephemeral CI and real API/worker integration tests;
- fail-closed provider boundary preparing AWS and GCP without advertising either as runtime-enabled.

## Canonical entry points

- Deployment: [`APPLY.md`](APPLY.md)
- Validation: [`VALIDATION_MATRIX.md`](VALIDATION_MATRIX.md)
- Changelog: [`CHANGELOG_V6_1_3.md`](CHANGELOG_V6_1_3.md)
- Runbook: `docs/operations/Runbook_Bevoac_V6_1_2_Production_Enterprise_Ready_R3.docx`
- From scratch: `docs/operations/Guide_From_Scratch_Bevoac_V6_1_2_R3.docx`
- V6.1.3 deployment guide: `docs/operations/Bevoac_V6_1_3_Enterprise_Release_Deployment_Guide.docx`
- Multi-cloud boundary: `docs/multicloud/MULTICLOUD_READINESS_V6_1_3.md`

## Local release validation

Node.js 24 and Terraform 1.14.7 are required.

```bash
./validate_release.sh --full
```

The full validation installs exact lockfile dependencies, runs API and worker checks/tests, validates every JavaScript/Bash/JSON source, initializes Terraform without a backend, validates the IaC and executes the static hardening gate.

## Azure deployment

The release is deployed in two controlled phases:

1. **Workload migration** — new images, dedicated database users and Managed Identities, while legacy rollback access remains temporarily available.
2. **Security finalization** — private Key Vault/PostgreSQL, Service Bus local authentication disabled, legacy Service Bus secret removed, broad workload RBAC removed.

Use only:

```bash
scripts/release/deploy_v6_1_3.sh help
```

No production claim is valid until CI, database, Azure identity, network, APIM, smoke, traffic rollout and evidence gates are green.

## Multi-cloud status

Azure is the only runtime-enabled provider. AWS and GCP are declared behind a versioned provider boundary and fail closed. The next AWS chantier can implement STS AssumeRole, discovery, preflight and scanners without redesigning tenant isolation, billing, outbox, persistence or reporting.

## Claims

This repository is designed as an enterprise release baseline. It is not an independent certification, a penetration-test report or a guarantee of zero residual risk. Environment-specific acceptance remains mandatory before the term “enterprise-ready production baseline” is used.
