# Bevoac V6.2.0 — Client-Ready Controlled Production

## Security and correctness

- transaction-local tenant context and corrupted-client eviction;
- request fingerprint bound to idempotency keys;
- constraint-specific database error mapping;
- strict HTTP schemas and bounded configuration;
- production PostgreSQL TLS enforcement;
- Managed Identity default for Service Bus;
- production admin OIDC tenant/role binding;
- encrypted authenticated onboarding state and safe redirect fragment;
- authenticated APIM backend boundary;
- security headers and no-store response policy.

## Worker and Azure

- shared API/worker module catalog;
- complete preflight module coverage;
- bounded Resource Graph skip-token pagination;
- visible partial/truncated evidence;
- RBAC and Private Link truncation remain PARTIAL after resources were analyzed;
- retryable/terminal error taxonomy;
- safe customer error persistence;
- Service Bus one-based delivery-count handling and abandon/dead-letter policy;
- invalid identifiable messages are persisted, refunded and recorded before DLQ;
- persistence failure for an invalid message abandons it instead of losing state;
- declared but runtime-disabled providers are persisted terminally and dead-lettered;
- AbortSignal propagation and explicit cancellation where supported;
- correct web SUCCESS/PARTIAL/FAILED semantics;
- target URL and retry-log redaction.

## Operations and IaC

- Action Group support;
- diagnostic settings for critical resources;
- metric and Activity Log alerts;
- controlled-production preconditions;
- Key Vault public default-deny transitional posture;
- Service Bus local-auth retirement gate;
- APIM backend token stored as secret and provided to API through Key Vault.

## CI and documentation

- Node 24 API/worker gates;
- frontend demo-only build/typecheck;
- PostgreSQL 16/RLS integration;
- CodeQL;
- dependency audit and SBOM;
- Trivy IaC/image scans;
- secret and documentation gates;
- literal relative import integrity gate;
- canonical V6.2 corpus;
- frontend explicitly classified DEMO ONLY.

## Compatibility

- V6.1.3 remains the immutable rollback baseline;
- the V6.2 DB migration is additive;
- Azure message contract remains supported;
- semantic multicloud contract naming is independent from product versions.

## Onboarding and frontend clarification

- the Microsoft callback now returns to a credential-free API-hosted result page;
- the legacy static onboarding page is disabled by default and forbidden in the controlled-production profile;
- the legacy static page contains no API-key field, no browser storage, no fetch call and no active onboarding flow;
- both bundled frontend implementations are explicitly non-contractual DEMO-ONLY artifacts.

## R2.1 dependency security refresh

- Removed the Swagger UI runtime and its static-file dependency chain.
- Kept an opt-in generated OpenAPI JSON endpoint at `/docs/openapi.json`.
- Pinned corrected `find-my-way`, `fast-uri`, and `fast-xml-parser` transitive versions.
- Removed the deprecated Azure Resource Graph SDK and its ms-rest / uuid 8 dependency chain; Resource Graph now uses an authenticated, fail-closed ARM REST adapter pinned to API version `2024-04-01`.
- Added a lockfile-aware dependency security gate and R2.1 regression tests.
