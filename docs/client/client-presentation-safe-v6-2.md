# Bevoac V6.2.0 — Client-safe presentation

Bevoac V6.2.0 is an Azure-first B2B audit API candidate for controlled production. It provides tenant-scoped authentication, verified Azure scopes, asynchronous scans, JSON results, PDF reporting, quotas, billing state, monitoring and operational procedures.

## Security position

- workload-specific PostgreSQL roles and forced RLS;
- transaction-local tenant context;
- API/worker contract validation;
- APIM plus Bevoac authentication;
- Managed Identity for Service Bus;
- bounded and sanitized scan processing;
- tested backup/restore and incident procedures required before contractual launch.

## Current network model

V6.2 uses a controlled public PaaS posture with explicit firewall/authentication controls. The full private-network architecture is planned for V7.0.0 and is activated when commercial, contractual or security requirements justify its cost.

## Limits

Do not describe the product as independently certified, zero-risk, fully private-networked or AWS-enabled until the corresponding evidence/release exists. The bundled frontend is demonstration-only and not the contractual customer portal.
## Interface scope

The contractual product is the API and its generated JSON/PDF results. The callback result page is credential-free. The Next.js dashboard and historical static onboarding page are demonstration artifacts and are not customer portals.
