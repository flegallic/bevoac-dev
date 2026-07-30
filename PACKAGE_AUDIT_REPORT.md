# Bevoac V6.1.3 package audit report

## Baseline

- Source export: commit `d542684381c0120f6b9e95e02bc97c1cce355712`.
- Source archive SHA-256: `aceaaa87fc029bd28dfc11e9aec250b3e6d04da6da5511781d46c217e370f6ce`.
- Target application version: `6.1.3-production-ready`.

## Controls embedded in the release

- exact lockfile dependency installation;
- API and worker syntax, dependency, contract and test gates;
- PostgreSQL 16 from-scratch CI with eight migrations;
- exact role/RLS/policy/grant verification;
- dynamic login and application integration tests;
- Terraform formatting, provider validation and static security checks;
- staged workload migration and security finalization;
- progressive API traffic rollout and rollback;
- post-deployment evidence collection with redaction and checksums;
- provider boundary with AWS/GCP fail-closed.

## Validation boundary

Static source validation and generated-artifact QA can be executed before deployment. Azure identity attachment, private DNS/connectivity, production PostgreSQL state, APIM behavior, revision traffic, queue state and rollback can only be proven against the target environment. These are mandatory deployment gates, not unimplemented source modifications.

## Security statement

The package does not claim independent certification, completed pentest, regulatory compliance or zero residual risk. It is an enterprise release baseline that becomes an enterprise-ready production baseline only after the acceptance matrix is signed with live evidence.
