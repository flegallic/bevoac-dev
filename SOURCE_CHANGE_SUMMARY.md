# Bevoac V6.2.0 — Source change summary R2

- Baseline commit: `d9b85ad728a9f1252ca2acd0b9421cd5ec9a7ba4`
- Candidate changed/added paths before final manifest: **174**

## By area

- API: 49
- CI: 1
- Documentation: 17
- Frontend demo: 14
- IaC: 14
- Release/CI scripts: 11
- Root release controls: 18
- Worker: 50

## Path inventory

| Status | Path |
|---|---|
| `M` | `.github/workflows/bevoac-enterprise-gates.yml` |
| `M` | `.gitignore` |
| `M` | `APPLY.md` |
| `A` | `APPLY_V6_2_0.md` |
| `A` | `CHANGELOG_V6_2_0.md` |
| `M` | `PACKAGE_AUDIT_REPORT.md` |
| `A` | `PACKAGE_CONTENTS.md` |
| `M` | `README.md` |
| `A` | `RELEASE_CANDIDATE_LIMITATIONS.md` |
| `M` | `RELEASE_VERSION` |
| `A` | `REMEDIATION_CLOSURE_MATRIX.md` |
| `A` | `SOURCE_BASELINE.json` |
| `A` | `SOURCE_CHANGE_SUMMARY.md` |
| `A` | `SOURCE_SHA256SUMS` |
| `M` | `VALIDATION_MATRIX.md` |
| `A` | `VALIDATION_MATRIX_V6_2_0.md` |
| `A` | `VALIDATION_REPORT_V6_2_0.md` |
| `A` | `VERIFY_SOURCE_PACKAGE.sh` |
| `A` | `bevoac-api-enterprise/contracts/module-catalog.json` |
| `A` | `bevoac-api-enterprise/migrations/202608030001_v620_request_integrity_worker_resilience.sql` |
| `M` | `bevoac-api-enterprise/package-lock.json` |
| `M` | `bevoac-api-enterprise/package.json` |
| `M` | `bevoac-api-enterprise/scripts/ci/verify-enterprise-db.js` |
| `M` | `bevoac-api-enterprise/scripts/init-db.js` |
| `M` | `bevoac-api-enterprise/scripts/lib/enterprise-db-expectations.js` |
| `A` | `bevoac-api-enterprise/scripts/run-tests.js` |
| `M` | `bevoac-api-enterprise/scripts/sync-contracts.js` |
| `M` | `bevoac-api-enterprise/src/config/env.js` |
| `A` | `bevoac-api-enterprise/src/lib/admin-oidc.js` |
| `A` | `bevoac-api-enterprise/src/lib/apim-boundary.js` |
| `A` | `bevoac-api-enterprise/src/lib/canonical-json.js` |
| `M` | `bevoac-api-enterprise/src/lib/db-context.js` |
| `M` | `bevoac-api-enterprise/src/lib/errors.js` |
| `A` | `bevoac-api-enterprise/src/lib/http-security-policy.js` |
| `A` | `bevoac-api-enterprise/src/lib/module-catalog.js` |
| `M` | `bevoac-api-enterprise/src/lib/onboarding-state.js` |
| `M` | `bevoac-api-enterprise/src/lib/scan-contract.js` |
| `A` | `bevoac-api-enterprise/src/plugins/apim-backend-boundary.js` |
| `M` | `bevoac-api-enterprise/src/plugins/auth-admin.js` |
| `M` | `bevoac-api-enterprise/src/plugins/postgres.js` |
| `A` | `bevoac-api-enterprise/src/plugins/security-headers.js` |
| `M` | `bevoac-api-enterprise/src/plugins/swagger.js` |
| `M` | `bevoac-api-enterprise/src/routes/admin-billing.js` |
| `M` | `bevoac-api-enterprise/src/routes/health.js` |
| `M` | `bevoac-api-enterprise/src/routes/onboarding-azure.js` |
| `M` | `bevoac-api-enterprise/src/routes/scans.js` |
| `M` | `bevoac-api-enterprise/src/server.js` |
| `M` | `bevoac-api-enterprise/src/services/azure-onboarding-service.js` |
| `M` | `bevoac-api-enterprise/src/services/billing-service.js` |
| `M` | `bevoac-api-enterprise/src/services/scan-service.js` |
| `M` | `bevoac-api-enterprise/tests/integration/public-api-postgres.integration.test.js` |
| `A` | `bevoac-api-enterprise/tests/security/admin-billing-schema-v620.test.js` |
| `A` | `bevoac-api-enterprise/tests/security/admin-role-v620.test.js` |
| `A` | `bevoac-api-enterprise/tests/security/apim-boundary-v620.test.js` |
| `A` | `bevoac-api-enterprise/tests/security/config-fail-closed-v620.test.js` |
| `A` | `bevoac-api-enterprise/tests/security/db-context-v620.test.js` |
| `A` | `bevoac-api-enterprise/tests/security/http-schema-v620.test.js` |
| `A` | `bevoac-api-enterprise/tests/security/idempotency-fingerprint-v620.test.js` |
| `A` | `bevoac-api-enterprise/tests/security/module-catalog-v620.test.js` |
| `M` | `bevoac-api-enterprise/tests/security/multi-tenant-auth.test.js` |
| `M` | `bevoac-api-enterprise/tests/security/onboarding-db-context.test.js` |
| `A` | `bevoac-api-enterprise/tests/security/onboarding-http-schema-v620.test.js` |
| `A` | `bevoac-api-enterprise/tests/security/onboarding-state-v620.test.js` |
| `M` | `bevoac-api-enterprise/tests/security/runtime-db-structure-runner.test.js` |
| `M` | `bevoac-api-enterprise/tests/security/runtime-iac-wiring.test.js` |
| `M` | `bevoac-api-enterprise/tests/security/runtime-separation.test.js` |
| `A` | `bevoac-api-enterprise/tests/security/security-headers-v620.test.js` |
| `M` | `bevoac-frontend-enterprise/.github/workflows/bevoac-frontend-enterprise.yml` |
| `M` | `bevoac-frontend-enterprise/Dockerfile` |
| `M` | `bevoac-frontend-enterprise/README.md` |
| `M` | `bevoac-frontend-enterprise/SECURITY.md` |
| `M` | `bevoac-frontend-enterprise/app/api/bevoac/route.ts` |
| `M` | `bevoac-frontend-enterprise/app/components/dashboard-shell.tsx` |
| `M` | `bevoac-frontend-enterprise/app/lib/demo-data.ts` |
| `M` | `bevoac-frontend-enterprise/app/lib/normalize.ts` |
| `M` | `bevoac-frontend-enterprise/app/lib/types.ts` |
| `M` | `bevoac-frontend-enterprise/deploy/README.md` |
| `M` | `bevoac-frontend-enterprise/deploy/deploy-azure.sh` |
| `M` | `bevoac-frontend-enterprise/deploy/prod.env.example` |
| `M` | `bevoac-frontend-enterprise/next.config.mjs` |
| `M` | `bevoac-frontend-enterprise/package.json` |
| `M` | `bevoac-iac-enterprise/admin-api.tf` |
| `M` | `bevoac-iac-enterprise/api-gateway-apim.tf` |
| `M` | `bevoac-iac-enterprise/container-apps.tf` |
| `M` | `bevoac-iac-enterprise/frontend/index.html.tftpl` |
| `M` | `bevoac-iac-enterprise/main.tf` |
| `M` | `bevoac-iac-enterprise/monitor-alerts.tf` |
| `A` | `bevoac-iac-enterprise/monitoring-v620.tf` |
| `A` | `bevoac-iac-enterprise/release/v6.2.0-controlled-production.tfvars.example` |
| `M` | `bevoac-iac-enterprise/scripts/static-hardening-check.sh` |
| `A` | `bevoac-iac-enterprise/v620-apim-backend-boundary.tf` |
| `A` | `bevoac-iac-enterprise/v620-controlled-production.tf` |
| `M` | `bevoac-iac-enterprise/variables-production-hardening.tf` |
| `M` | `bevoac-iac-enterprise/variables-v6-1-3.tf` |
| `M` | `bevoac-iac-enterprise/variables.tf` |
| `M` | `bevoac-worker-enterprise/Dockerfile` |
| `A` | `bevoac-worker-enterprise/contracts/module-catalog.json` |
| `R087` | `bevoac-worker-enterprise/contracts/scan-request.v2.multicloud.schema.json` |
| `M` | `bevoac-worker-enterprise/package-lock.json` |
| `M` | `bevoac-worker-enterprise/package.json` |
| `M` | `bevoac-worker-enterprise/scanners/azure/azureInfra.js` |
| `M` | `bevoac-worker-enterprise/scanners/azure/azure_rbac_exposure.js` |
| `M` | `bevoac-worker-enterprise/scanners/azure/checkEntraID.js` |
| `M` | `bevoac-worker-enterprise/scanners/azure/diagnostic_coverage.js` |
| `M` | `bevoac-worker-enterprise/scanners/azure/encryption_coverage.js` |
| `M` | `bevoac-worker-enterprise/scanners/azure/exposure_map.js` |
| `M` | `bevoac-worker-enterprise/scanners/azure/identity_admin_posture.js` |
| `M` | `bevoac-worker-enterprise/scanners/azure/policy_compliance.js` |
| `M` | `bevoac-worker-enterprise/scanners/azure/private_link_coverage.js` |
| `M` | `bevoac-worker-enterprise/scanners/azure/tags.js` |
| `M` | `bevoac-worker-enterprise/scanners/generic/checkDNS.js` |
| `M` | `bevoac-worker-enterprise/scanners/generic/checkHeaders.js` |
| `M` | `bevoac-worker-enterprise/scanners/generic/checkSSL.js` |
| `M` | `bevoac-worker-enterprise/scanners/generic/runNmap.js` |
| `A` | `bevoac-worker-enterprise/scripts/run-tests.js` |
| `M` | `bevoac-worker-enterprise/src/config/env.js` |
| `A` | `bevoac-worker-enterprise/src/lib/abort.js` |
| `M` | `bevoac-worker-enterprise/src/lib/db-context.js` |
| `A` | `bevoac-worker-enterprise/src/lib/module-catalog.js` |
| `M` | `bevoac-worker-enterprise/src/lib/module-timeout.js` |
| `M` | `bevoac-worker-enterprise/src/lib/network-guard.js` |
| `A` | `bevoac-worker-enterprise/src/lib/resource-graph-evidence.js` |
| `M` | `bevoac-worker-enterprise/src/lib/resource-graph.js` |
| `M` | `bevoac-worker-enterprise/src/lib/resource-preflight.js` |
| `A` | `bevoac-worker-enterprise/src/lib/result-sanitizer.js` |
| `M` | `bevoac-worker-enterprise/src/lib/retry.js` |
| `M` | `bevoac-worker-enterprise/src/lib/status-semantics.js` |
| `A` | `bevoac-worker-enterprise/src/lib/worker-errors.js` |
| `M` | `bevoac-worker-enterprise/src/providers/provider-registry.js` |
| `M` | `bevoac-worker-enterprise/src/services/audit-runner.js` |
| `M` | `bevoac-worker-enterprise/src/services/message-processor.js` |
| `M` | `bevoac-worker-enterprise/src/services/scan-store.js` |
| `A` | `bevoac-worker-enterprise/tests/config-fail-closed-v620.test.js` |
| `A` | `bevoac-worker-enterprise/tests/db-context-v620.test.js` |
| `A` | `bevoac-worker-enterprise/tests/message-processor-retry-v620.test.js` |
| `A` | `bevoac-worker-enterprise/tests/module-catalog-preflight-v620.test.js` |
| `A` | `bevoac-worker-enterprise/tests/module-timeout-v620.test.js` |
| `M` | `bevoac-worker-enterprise/tests/provider-boundary-runtime.test.js` |
| `M` | `bevoac-worker-enterprise/tests/provider-registry.test.js` |
| `A` | `bevoac-worker-enterprise/tests/resource-graph-pagination-v620.test.js` |
| `A` | `bevoac-worker-enterprise/tests/result-sanitizer-v620.test.js` |
| `A` | `bevoac-worker-enterprise/tests/scan-store-ownership-v620.test.js` |
| `A` | `bevoac-worker-enterprise/tests/status-semantics-v620.test.js` |
| `A` | `bevoac-worker-enterprise/tests/tags-resource-graph-pagination-v620.test.js` |
| `A` | `bevoac-worker-enterprise/tests/worker-errors-v620.test.js` |
| `M` | `docs/MANIFEST.json` |
| `A` | `docs/MANIFEST.md` |
| `M` | `docs/README.md` |
| `M` | `docs/TRACEABILITY.md` |
| `A` | `docs/client/client-presentation-safe-v6-2.md` |
| `A` | `docs/evidence/FINDINGS_CLOSURE_V6_2.csv` |
| `A` | `docs/evidence/FINDINGS_CLOSURE_V6_2.md` |
| `A` | `docs/evidence/SOURCE_VALIDATION_V6_2_0.md` |
| `A` | `docs/operations/incident-response-v6-2.md` |
| `A` | `docs/operations/monitoring-alerting-v6-2.md` |
| `A` | `docs/operations/postgres-backup-restore-v6-2.md` |
| `A` | `docs/operations/release-validation-v6-2.md` |
| `A` | `docs/operations/runbook-v6-2.md` |
| `A` | `docs/technical/api-contract-v6-2.md` |
| `A` | `docs/technical/architecture-v6-2.md` |
| `A` | `docs/technical/security-model-v6-2.md` |
| `A` | `docs/testing/test-strategy-v6-2.md` |
| `A` | `scripts/ci/docs-gate.py` |
| `M` | `scripts/ci/postgres-enterprise-gate.sh` |
| `A` | `scripts/ci/relative-import-gate.py` |
| `A` | `scripts/ci/secret-pattern-scan.py` |
| `A` | `scripts/ci/source-security-gate.sh` |
| `A` | `scripts/ci/terraform-static-reference-check.py` |
| `A` | `scripts/release/collect_v6_2_0_evidence.sh` |
| `A` | `scripts/release/release_v6_2_0.sh` |
| `A` | `scripts/release/test_v6_2_0_local.sh` |
| `M` | `scripts/release/validate_v6_1_3.py` |
| `A` | `scripts/release/validate_v6_2_0.py` |
| `M` | `validate_release.sh` |

This inventory is generated from the reconstructed Git baseline. `SOURCE_SHA256SUMS` is generated after the source tree is frozen.


## R2.2 — qualification PostgreSQL locale

- profil local `NODE_ENV=test` avec `PG_SSL_MODE=disable` ;
- règle de production fail-closed inchangée ;
- runner Docker Desktop-aware intégré ;
- fallback anonyme isolé pour l’image publique PostgreSQL ;
- test de régression et documentation associés ;
- aucun changement API/worker runtime, package manifest ou lockfile.

## R2.3 — Terraform expression correction

- replaced the invalid APIM policy conditional-heredoc with an unambiguous
  `join("\n", [...])` expression;
- added a static regression gate rejecting `? <<HEREDOC` constructs;
- added a versioned backend-disabled Terraform qualification runner;
- did not change API, worker, database migration, package or lockfile content.
