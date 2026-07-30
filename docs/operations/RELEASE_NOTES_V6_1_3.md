# Bevoac V6.1.3 — enterprise runtime wiring release

## Purpose

V6.1.3 deploys the security model validated in V6.1.2: real PostgreSQL identities, forced RLS, dedicated Managed Identities, isolated runtime modes and reproducible PostgreSQL/application gates. The public `/v1` API and active `scan.requested` contract remain compatible.

## Workload mapping

| Workload | Runtime mode | PostgreSQL user | Service Bus |
|---|---|---|---|
| Public API | `public_api` | `bevoac_api` | No configuration when dedicated outbox is enabled |
| Worker | worker entry point | `bevoac_worker` | Receiver and KEDA scaler by worker UAMI |
| Outbox | `outbox` | `bevoac_outbox` | Sender by outbox UAMI |
| Retention | `retention` | `bevoac_retention` | None |
| Admin API | `admin_api` | `bevoac_admin_api` | None; internal ingress and OIDC |
| Provisioning | CLI only | `bevoac_operator` / `bevoacadmin` | None |

## Staged migration

The release deliberately separates two changes that must not be collapsed into one unobserved production apply.

### Phase 1 — workload migration

- deploy V6.1.3 images;
- synchronize the six runtime-role passwords;
- apply/verify the eight migrations and exact RLS boundary;
- attach dedicated identities and secret-scoped roles;
- keep current network connectivity, Service Bus local auth, the legacy connection-string secret and legacy broad API/worker roles temporarily available for rollback;
- create the API candidate at 0%, smoke it and roll traffic 5% → 25% → 100%.

### Phase 2 — security finalization

Only after Phase 1 acceptance:

- enable Key Vault/PostgreSQL private endpoints;
- disable PostgreSQL public access and public firewall rules;
- disable Service Bus local/SAS authentication;
- remove the legacy Service Bus connection-string secret;
- remove the public API Sender assignment;
- remove API/worker vault-wide secret-reader assignments;
- verify the final posture from a private administrative path.

## Service Bus network decision

The existing namespace is Standard. V6.1.3 keeps its public endpoint, enforces TLS 1.2 and uses Entra Managed Identity/RBAC. Private endpoints are not claimed because they require a future Premium-tier migration.

## Quality evidence

- PostgreSQL 16 ephemeral CI;
- exactly eight migrations, six hardened roles, 15 forced-RLS tables, 29 policies and 58 exact table grants;
- HTTP 401/200/404 tenant tests through `Fastify.inject()`;
- transactional outbox persistence without Service Bus;
- worker persistence test without cloud calls;
- provider boundary tests keeping AWS/GCP disabled;
- Terraform and static security gates.

## Compatibility

- Public routes: unchanged.
- Active message contract: unchanged.
- Azure scanner modules: unchanged.
- AWS/GCP: not runtime-enabled.

## Status language

Before CI and live acceptance: **deployment-ready release candidate**. After signed database, Azure, APIM, rollout and rollback evidence: **enterprise-ready production baseline**.
