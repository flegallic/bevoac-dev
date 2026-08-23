# Architecture Bevoac V6.2.0

## Control plane

```text
Client
  -> APIM subscription + Bevoac API key
  -> public API Container App
  -> PostgreSQL transaction: scan + billing + idempotency + outbox
  -> outbox publisher
  -> Service Bus session by tenant
  -> worker
  -> Azure/web modules
  -> normalized result + KPI + PDF
```

## Workload identities

- `bevoac_api` / API Managed Identity;
- `bevoac_worker` / worker Managed Identity;
- `bevoac_outbox` / outbox Managed Identity;
- `bevoac_retention` / retention Managed Identity;
- `bevoac_admin_api` / isolated internal admin API;
- `bevoac_operator` / controlled operator boundary.

## Tenant boundary

The tenant is derived from the authenticated API key. Tenant-aware PostgreSQL operations use a transaction-local context. Forced RLS, runtime roles and explicit tenant predicates provide defense in depth. A connection with a failed rollback is destroyed rather than returned to the pool.

## Controlled public network posture

V6.2.0 intentionally precedes the V7 private-network pack. Publicly addressable services remain authenticated and restricted:

- PostgreSQL: explicit firewall IPs only;
- Key Vault: default Deny with explicit NAT/operator rules;
- Service Bus: Managed Identity only, local authentication disabled;
- ACR: admin and anonymous pull disabled;
- API: APIM backend token required for business routes;
- Admin API: internal ingress.

## Versioning

Product release, public API, message schema and finding schema are versioned independently. The multicloud message contract is semantic V2 and is not named after V7.
