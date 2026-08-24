# V6.2.0 findings closure matrix

**Meaning of status:**

- `SOURCE_IMPLEMENTED`: remediation exists in this source candidate.
- `LOCALLY_STATIC_VALIDATED`: syntax/static/pure tests executed in the delivery environment.
- `CI_OR_LIVE_PROOF_REQUIRED`: full Node 24, PostgreSQL, Terraform or Azure proof remains a release gate.

| Finding | Source remediation | Status |
|---|---|---|
| REL-001 | V6.2 canonical validator aligns rollback-conditional Service Bus secret and current Key Vault model | SOURCE_IMPLEMENTED |
| DOC-001 | baseline commit/archive SHA corrected and release evidence generated from the candidate | SOURCE_IMPLEMENTED |
| TEN-001 | transaction-local tenant context; failed rollback destroys client | LOCALLY_STATIC_VALIDATED |
| SEC-APIM-001 | rotatable APIM backend secret, API enforcement and direct-call test | CI_OR_LIVE_PROOF_REQUIRED |
| IDEM-001 | canonical SHA-256 request fingerprint and deterministic 409 | LOCALLY_STATIC_VALIDATED |
| IDEM-002 | constraint-specific uniqueness mapping | LOCALLY_STATIC_VALIDATED |
| AZR-001 | shared module catalog across API/worker/preflight | LOCALLY_STATIC_VALIDATED |
| AZR-002 | bounded skip-token pagination and visible partial/truncation evidence | LOCALLY_STATIC_VALIDATED |
| AZR-003 | RBAC and Private Link truncation remains PARTIAL after resources were analyzed | LOCALLY_STATIC_VALIDATED |
| WRK-001 | retryable/terminal taxonomy and Service Bus disposition policy | LOCALLY_STATIC_VALIDATED |
| WRK-002 | separate safe customer failure and redacted operator diagnostics | LOCALLY_STATIC_VALIDATED |
| WRK-003 | AbortSignal propagation and explicit process/network cancellation where supported | CI_OR_LIVE_PROOF_REQUIRED |
| WRK-004 | dependency overrides merged over defaults | LOCALLY_STATIC_VALIDATED |
| WRK-005 | web execution SUCCESS/PARTIAL/FAILED semantics | LOCALLY_STATIC_VALIDATED |
| WRK-006 | invalid identifiable job is persisted/refunded before DLQ; persistence failure abandons | LOCALLY_STATIC_VALIDATED |
| WRK-007 | disabled provider is persisted terminally and dead-lettered | LOCALLY_STATIC_VALIDATED |
| WEB-001 | safe target display removes query/hash and sensitive material | LOCALLY_STATIC_VALIDATED |
| LOG-001 | safe retry log projection | LOCALLY_STATIC_VALIDATED |
| API-001 | strict schemas and bounded pagination/UUIDs | CI_OR_LIVE_PROOF_REQUIRED |
| API-002/API-005 | no-store and API security headers | CI_OR_LIVE_PROOF_REQUIRED |
| API-003 | release-derived wording and production Swagger disabled | SOURCE_IMPLEMENTED |
| API-004 | live/ready/deep probes | CI_OR_LIVE_PROOF_REQUIRED |
| CFG-001 | production Managed Identity default; connection string only explicit rollback | LOCALLY_STATIC_VALIDATED |
| CFG-002 | production rejects disabled PostgreSQL TLS | LOCALLY_STATIC_VALIDATED |
| CFG-003 | bounded integer/number/boolean validation | LOCALLY_STATIC_VALIDATED |
| AUTH-001 | roles-only authorization plus issuer/audience/tenant validation | CI_OR_LIVE_PROOF_REQUIRED |
| AUTH-002 | production shared-secret admin path removed | LOCALLY_STATIC_VALIDATED |
| ONB-001 | authenticated encrypted opaque state, replay/session DB check and fragment-only safe redirect | LOCALLY_STATIC_VALIDATED |
| ONB-002 | HTTPS and allowed-origin startup validation | LOCALLY_STATIC_VALIDATED |
| CI-001 | frontend, JavaScript/TypeScript SAST, SCA, SBOM, Trivy, secret/IaC/docs gates | CI_OR_LIVE_PROOF_REQUIRED |
| CI-002 | literal relative import resolution gate | LOCALLY_STATIC_VALIDATED |
| IAC-OBS-001 | Action Group, diagnostics, metric/activity alerts and production preconditions | CI_OR_LIVE_PROOF_REQUIRED |
| DOC-002 | canonical V6.2 corpus and documentation gate | SOURCE_IMPLEMENTED |
| DOC-003 | semantic `scan-request.v2.multicloud` contract naming | LOCALLY_STATIC_VALIDATED |
| FRT-001/FRT-002/FRT-003 | frontend converted to explicit demo-only artifact with no API-key storage/proxy/live fallback | CI_OR_LIVE_PROOF_REQUIRED |

The V6.2 release is not declared production-accepted until every `CI_OR_LIVE_PROOF_REQUIRED` row has an evidence artifact.

## Ten priority findings requested for the consolidated source

The exact closure mapping is maintained at repository root in `REMEDIATION_CLOSURE_MATRIX.md`. The source decision for finding 10 covers both bundled interfaces: the Next.js dashboard and the legacy Terraform static onboarding page. Both are DEMO ONLY; neither collects or persists a customer API key in the V6.2 candidate.
