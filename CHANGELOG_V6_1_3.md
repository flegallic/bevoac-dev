# Changelog V6.1.3

## Runtime security

- Wire public API, worker, outbox, retention and admin API to dedicated PostgreSQL runtime roles.
- Move outbox and retention from the API identity to dedicated Managed Identities.
- Add a separate internal administration API runtime with OIDC.
- Replace the worker SAS-backed Service Bus scaler with a user-assigned Managed Identity scale rule.
- Keep the public API free of Service Bus configuration when the dedicated outbox is enabled.
- Add secret-scoped Key Vault roles for every workload.
- Add a staged cleanup gate for the former API/worker vault-wide readers and public-API Service Bus Sender role.
- Add a staged cleanup gate for the legacy Service Bus connection-string secret and local/SAS authentication.
- Keep Service Bus Standard on its supported public endpoint with TLS 1.2; Private Link remains a future Premium-tier decision.
- Add explicit workload-migration and security-finalization Terraform profiles instead of an implicit tracked auto-tfvars override.

## Release safety

- Create the public API candidate revision at 0% while the known stable revision stays at 100%.
- Add direct candidate health/auth tests, 5/25/100 traffic rollout and immediate traffic rollback.
- Separate the workload migration from the private-network/RBAC finalization so existing workloads remain recoverable.
- Add a read-only production database structure verifier for exact migrations, roles, RLS, policies, grants and function ACLs.
- Add post-deployment evidence collection with redaction and checksums.

## Quality gates

- Add PostgreSQL 16 ephemeral CI with full schema bootstrap and eight migrations.
- Validate six hardened runtime roles, 15 forced-RLS tables, 29 policies and 58 exact table privileges.
- Add Fastify integration tests using the real PostgreSQL API-key function and RLS.
- Verify that a public API request persists a durable outbox event without opening Service Bus.
- Add a worker PostgreSQL integration test without Azure, Service Bus, AWS or GCP calls.
- Add IaC, provider-boundary, role-sync and database-verifier anti-regression tests.
- Extract the worker message processor behind injectable dependencies for hermetic provider tests.

## Multi-cloud foundation

- Add a provider adapter V1 contract and normalized provider-finding boundary.
- Declare Azure, AWS and GCP capabilities through a fail-closed registry.
- Document AWS STS AssumeRole/ExternalId, discovery, preflight, scanners and acceptance gates.
- Keep AWS and GCP runtime-disabled until credential ownership, scanners, billing, tenant isolation and integration evidence are complete.

## Compatibility

- No public API route change.
- No active `scan.requested` contract change.
- No Azure scanner module removal.
- Existing V6.1.2 workloads remain operational during the workload migration phase.
