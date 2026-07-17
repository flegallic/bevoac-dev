# AWS provider scaffold

This directory is intentionally not wired to runtime in V6.1.2 enterprise hardening.

Mandatory implementation gates before enabling `cloudProvider=aws`:

1. Credential model based on customer-owned IAM role and external ID.
2. STS AssumeRole adapter with region allowlist and timeout controls.
3. AWS account/region inventory with quota preflight.
4. Module adapters: IAM, S3, EC2/security groups, KMS, CloudTrail, Config, RDS, cost posture.
5. Findings normalized to Bevoac finding schema.
6. Tenant isolation tests for AWS credentials and results.
7. DLQ/retry scenarios.
8. Documentation and customer consent model.
