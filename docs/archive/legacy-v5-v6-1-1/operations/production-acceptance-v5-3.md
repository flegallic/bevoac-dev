# Bevoac V5.3 - Production acceptance with known defects

Version: V5.3.0-production-acceptance
Audience: CTO, RSSI, Architecte cloud, Lead backend, exploitation Bevoac.

## Positionnement

Bevoac V5.3 is a production-oriented B2B SaaS API baseline. It can be used for a controlled production or pilot environment when the known residual risks are accepted by the product owner and documented for the client context.

This document deliberately does not claim a full enterprise certification. It clarifies the operational line between:

- acceptable controlled production defects;
- mandatory compensating controls;
- no-go items for a highly regulated enterprise deployment.

## Accepted risk register

| Risk | V5.3 status | Compensating control | Production acceptability |
|---|---|---|---|
| Full enterprise proof not complete | Known and documented | Client wording: production-oriented controlled B2B API, not enterprise-certified | Acceptable for controlled B2B production |
| PostgreSQL RLS not enabled by default | Known | Tenant integrity constraints, cross-table guards, tenant isolation checks, API tenant filters | Acceptable if RLS decision is documented |
| APIM double-auth can surprise clients | Controlled | `apim_subscription_required` variable, APIM smoke test, client integration guide | Acceptable if documented in onboarding pack |
| Outbox coupled to API | Corrected by dedicated publisher option | Dedicated Container App outbox publisher; API publisher disabled when enabled | Acceptable when enabled |
| Terraform from local workstation vs private Key Vault | Known ops risk | Private runner/VNet/VPN preflight and runbook | Acceptable with documented operator model |
| Multi-tenant load not proven by default | Corrected by k6 scenario | Multi-tenant load test must be run before broad rollout | Acceptable after test evidence |
| Backup/restore not in current scope | Deliberately accepted by product owner | Data retention and client contract must state scope | Acceptable only if business explicitly accepts it |

## Mandatory gates before client-facing production

1. `npm run check` and `npm test` pass for API.
2. `npm run check` passes for worker.
3. `terraform validate` and `scripts/static-hardening-check.sh` pass.
4. Dedicated outbox publisher is enabled or explicit exception is signed off.
5. `npm run check:tenant-isolation` passes against the target database.
6. APIM mode is documented: Bevoac key only or APIM key + Bevoac key.
7. DLQ is zero outside intentional tests.
8. Multi-tenant k6 test has been executed and stored as release evidence.
9. Known defects and accepted risks are attached to the client environment record.

## Client wording

Recommended wording:

> Bevoac V5.3 is a production-oriented Azure-first B2B audit API. It includes server idempotency, transactional outbox, tenant-scoped authorization, asynchronous workers, billing state transitions, retention, alerting and an optional APIM gateway. The platform is suitable for controlled B2B production or pilot use when the documented operating model and accepted residual risks are approved.

Forbidden wording unless separately proven:

- fully enterprise-certified;
- zero-risk tenant isolation;
- regulated-grade compliance out of the box;
- multi-cloud runtime;
- pentest-validated if no pentest was performed.


> Documentation V5.3 alignment note: this file is part of the active V5.3 documentation set. V5.2 equivalents are historical references only.
