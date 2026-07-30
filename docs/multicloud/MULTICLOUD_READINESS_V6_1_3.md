# Multi-cloud readiness after Bevoac V6.1.3

## Stable provider-neutral platform

Tenant authentication, API-key scopes, idempotency, billing, quotas, transactional outbox, scan attempts, result storage, normalized findings, JSON/PDF reporting, RLS, retention and audit logging remain provider-neutral.

## Provider adapter V1

Every provider implementation must expose:

1. `validateCredentialReference()` - validate a customer-owned federated credential reference without persisting long-lived keys.
2. `discoverScope()` - resolve account, organization, project, subscription and region boundaries.
3. `preflight()` - count resources and enforce plan limits before the scan.
4. `runModules()` - execute provider-specific modules with bounded timeout and retry behavior.
5. `normalizeFindings()` - map provider evidence to the common Bevoac finding contract.

## AWS first chantier

- Customer-owned IAM Role and unique ExternalId.
- STS AssumeRole only; no static AWS access key in Bevoac configuration.
- Account and AWS Organizations ownership verification.
- Explicit account, organization and region allowlists.
- Initial modules: IAM, S3, EC2, Security Groups, KMS, CloudTrail, Config, RDS, Security Hub and cost posture.
- Tenant isolation, quota, retry, DLQ, evidence redaction and normalized reporting tests.
- No change to the public Azure contract until a versioned provider contract change is approved.

## GCP later chantier

- Workload Identity Federation or customer-owned service account impersonation.
- Organization, folder and project ownership verification.
- Explicit project and region allowlists.
- IAM, Storage, Compute, Firewall, KMS, Logging, Security Command Center, SQL and cost posture modules.

## Runtime status

Azure is runtime-enabled. AWS is `foundation_only_not_runtime_enabled`. GCP is `roadmap_not_runtime_enabled`. Any code path that tries to execute a disabled provider must fail closed with `PROVIDER_NOT_RUNTIME_ENABLED`.
