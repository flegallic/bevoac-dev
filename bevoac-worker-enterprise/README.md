# bevoac-worker-enterprise 6.1.3

Asynchronous Bevoac scan worker. It consumes versioned `scan.requested` messages, persists attempts/results and finalizes billing under the restricted PostgreSQL login `bevoac_worker`.

## Runtime security

- Azure Service Bus authentication by user-assigned Managed Identity.
- Queue scaling by the same Managed Identity; no SAS scaler secret.
- Tenant context set before all protected database operations.
- No access to tenant administration or API-key authentication function.
- Invalid or disabled providers fail closed before attempt acquisition.

## Provider boundary

Azure is runtime-enabled. AWS and GCP are registered but disabled. New providers must implement the provider adapter contract, credential ownership proof, preflight, bounded scanners, normalized findings and integration tests before enablement.

## Commands

```bash
npm ci
npm run check
npm test
npm start
```
