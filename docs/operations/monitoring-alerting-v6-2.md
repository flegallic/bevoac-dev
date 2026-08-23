# Monitoring and alerting Bevoac V6.2.0

## Terraform-managed baseline

- Action Group or existing Action Group binding;
- diagnostics for PostgreSQL, Key Vault, Service Bus, APIM, ACR, Storage and Container Apps Environment;
- Service Bus DLQ and backlog alerts;
- PostgreSQL CPU, memory and storage alerts;
- resource-group deletion and RBAC change alerts.

## Application telemetry

Logs include correlation ID, scan ID, safe tenant reference, provider, module, attempt and duration. Secrets, API keys, tokens, connection strings and customer evidence payloads are redacted.

## Acceptance

Monitoring is not accepted because Terraform contains resources. Acceptance requires:

1. a real notification test;
2. evidence that diagnostics reach Log Analytics;
3. an owner and escalation path;
4. reviewed thresholds;
5. a noise/false-positive review.
