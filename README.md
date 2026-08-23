# Bevoac V6.2.0 R2.2 — Client-Ready Controlled Production candidate

Bevoac is an Azure-first B2B SaaS control plane for security-audit orchestration. This source tree is the complete V6.2.0 remediation candidate based on the immutable V6.1.3 production baseline `d9b85ad728a9f1252ca2acd0b9421cd5ec9a7ba4`.


## R2.2 final source revision

R2.1 closed the dependency-qualification findings. 
R2.2 preserves the R2.1 API, worker, package manifests and lockfiles, and corrects only the PostgreSQL 16 qualification profile and runner. The local enterprise gate now uses `NODE_ENV=test` with disabled TLS against a disposable container, while production continues to fail closed. Docker Desktop CLI and credential-helper paths are preserved, with an isolated anonymous fallback for the public PostgreSQL image. See [`POSTGRES16_QUALIFICATION_R2_2.md`](POSTGRES16_QUALIFICATION_R2_2.md).

- API Swagger UI/static-file chain removed while retaining opt-in OpenAPI JSON;
- API dependency lock proven with zero npm audit findings on Node.js 24.19.0;
- deprecated Azure Resource Graph SDK chain removed from the worker;
- Resource Graph transported through the authenticated Azure Resource Manager REST API (`2024-04-01`);
- deterministic lockfile-derived CycloneDX 1.6 SBOMs included;
- native `npm sbom` is not used as a release gate.

See [`DEPENDENCY_SECURITY_REFRESH_R2_1.md`](DEPENDENCY_SECURITY_REFRESH_R2_1.md) and [`FINAL_QUALIFICATION_STATUS.md`](FINAL_QUALIFICATION_STATUS.md).

## Scope

V6.2.0 closes the known source findings identified by the V6.1.3 audit:

- release evidence and validator consistency;
- PostgreSQL tenant-context safety;
- request-bound idempotency;
- shared Azure module catalog and Resource Graph pagination;
- retryable-versus-terminal worker failures;
- customer-visible error sanitization and cancellation propagation;
- fail-closed HTTP/configuration/admin OIDC controls;
- authenticated APIM-to-backend boundary;
- diagnostics, Action Group and baseline alerts in Terraform;
- demo-only frontend classification;
- CI supply-chain and documentation gates.

## Runtime status

- Public API: Azure-first, `/v1`, controlled production candidate.
- Worker: Azure runtime enabled; AWS/GCP remain fail-closed.
- Frontend: **DEMO-ONLY** and excluded from contractual client-portal scope.
- V6.3.0: AWS multicloud implementation after V6.2.0 acceptance.
- V7.0.0: Enterprise Network Pack (VPN, private runner, private endpoints, private DNS and private backend).

## Canonical documentation

- [`docs/README.md`](docs/README.md)
- [`docs/operations/runbook-v6-2.md`](docs/operations/runbook-v6-2.md)
- [`docs/operations/release-validation-v6-2.md`](docs/operations/release-validation-v6-2.md)
- [`docs/technical/architecture-v6-2.md`](docs/technical/architecture-v6-2.md)
- [`docs/technical/security-model-v6-2.md`](docs/technical/security-model-v6-2.md)
- [`docs/evidence/FINDINGS_CLOSURE_V6_2.md`](docs/evidence/FINDINGS_CLOSURE_V6_2.md)
- [`docs/evidence/SOURCE_VALIDATION_V6_2_0.md`](docs/evidence/SOURCE_VALIDATION_V6_2_0.md)
- [`REMEDIATION_CLOSURE_MATRIX.md`](REMEDIATION_CLOSURE_MATRIX.md)
- [`VALIDATION_REPORT_V6_2_0.md`](VALIDATION_REPORT_V6_2_0.md)
- [`RELEASE_CANDIDATE_LIMITATIONS.md`](RELEASE_CANDIDATE_LIMITATIONS.md)

## Validation

Node.js 24 and Terraform 1.14.7 are required for the complete gate.

```bash
./validate_release.sh --full
```

Static structure validation:

```bash
./validate_release.sh --structure-only
```

## Production rule

This source candidate is not considered deployed or production-accepted until the full CI, PostgreSQL/RLS, Terraform, Azure monitoring, restore, APIM boundary, load, security, real-tenant and rollback gates have produced an evidence pack.
