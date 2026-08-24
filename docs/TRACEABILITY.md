# Traçabilité V6.1.3 → V6.2.0

## Baseline source

| Item | Value |
|---|---|
| Baseline commit | `d9b85ad728a9f1252ca2acd0b9421cd5ec9a7ba4` |
| Baseline source SHA-256 | `f2448c3a71e05fc06e95457fa59035f3b4e7512c9085162ff026f5a4f091a588` |
| Baseline tag | `v6.1.3-final-deployment-safety` |
| Candidate | `6.2.0-client-ready-controlled-production` |

## Database

- Previous expected migrations: 8.
- V6.2 expected migrations: 9.
- New migration: `202608030001_v620_request_integrity_worker_resilience.sql`.
- The full PG16 gate must rebuild from zero and validate runtime roles, RLS, policies, grants, idempotency and worker states.

## Source-remediation groups

| Group | Scope |
|---|---|
| A | release validator and evidence truth |
| B | tenant context and RLS safety |
| C | idempotency, HTTP and fail-closed config |
| D | module catalog and Resource Graph pagination |
| E | worker retry/error/cancellation semantics |
| F | APIM boundary and HTTP security |
| G | CI, supply chain and observability IaC |
| H | frontend demo-only classification |

## Live proof still required

- Node 24 complete tests;
- PostgreSQL 16 integration;
- Terraform validation and reviewed plan;
- diagnostics and alert notification;
- APIM direct-versus-gateway smoke;
- Service Bus Entra-only transition;
- secret rotation;
- restore drill;
- load test;
- security review/pentest;
- tenant client acceptance;
- rollback rehearsal.

The evidence index must bind each proof to the candidate Git commit, image digests, Terraform plan SHA and execution timestamp.
## V6.2 consolidated package controls

- `SOURCE_BASELINE.json` records the immutable source baseline;
- `REMEDIATION_CLOSURE_MATRIX.md` maps the ten priority findings to source and tests;
- `SOURCE_SHA256SUMS` is generated only after the final source tree is frozen;
- `VERIFY_SOURCE_PACKAGE.sh` verifies every manifested source file;
- the legacy static onboarding page is disabled and credential-free.

## Validation source R2

- `docs/evidence/SOURCE_VALIDATION_V6_2_0.md` consolide les résultats statiques du candidat ;
- `scripts/ci/relative-import-gate.py` vérifie chaque import relatif littéral ;
- le worker persiste et rembourse les messages invalides identifiables avant DLQ ;
- le compteur Service Bus est traité comme one-based ;
- les providers déclarés mais non activés sont persistés en état terminal puis dead-lettered.
