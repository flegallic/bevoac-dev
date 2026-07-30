# bevoac-api-enterprise 6.1.3

Fastify B2B control-plane runtime for tenant-scoped scan orchestration, onboarding, billing, result access and PDF reporting.

## Runtime modes

- `public_api`: public client routes only; PostgreSQL user `bevoac_api`; no Service Bus configuration when the dedicated outbox is enabled.
- `admin_api`: administration routes only; internal ingress; PostgreSQL user `bevoac_admin_api`; OIDC required.
- `outbox`: non-HTTP dedicated publisher; PostgreSQL user `bevoac_outbox`; Managed Identity Service Bus Sender.
- `retention`: scheduled maintenance; PostgreSQL user `bevoac_retention`.
- `combined`: retained for controlled compatibility, not the target production split.

## Security boundary

- API keys are authenticated through `public.bevoac_authenticate_api_key()`; the runtime has no direct `api_keys` read.
- Tenant identity is server-derived.
- `app.current_tenant_id` is set on the checked-out PostgreSQL connection.
- RLS is bound to `session_user`; `app.service_context` is forbidden.
- Web/Azure targets must be authorized for the tenant.
- Embedded outbox publication is disabled in the target public API, but the durable `outbox_events` insert remains transactional.

## Commands

```bash
npm ci
npm run check
npm test
npm run migrate-db
npm run migrate-db:secure-api-key-auth
npm run migrate-db:runtime-role-rls
npm run check-db:runtime-boundary
```

Migration and structural verification require the PostgreSQL administration login. Application workloads must never use `bevoacadmin`.
