# Bevoac V6.1.3 validation matrix

| Domain | Gate | Required result | Blocking |
|---|---|---|---:|
| Source | `./validate_release.sh --full` | Exit 0 | Yes |
| API | `npm ci && npm run check && npm test` | All tests pass | Yes |
| Worker | `npm ci && npm run check && npm test` | All tests pass | Yes |
| Terraform | `fmt`, `init -backend=false`, `validate` | Exit 0 | Yes |
| Static IaC | `scripts/static-hardening-check.sh` | All controls OK | Yes |
| PostgreSQL CI | `scripts/ci/postgres-enterprise-gate.sh` | Ephemeral PG16 gate OK | Yes |
| Migrations | Structural verifier | Exactly 8 expected migrations | Yes |
| Roles | Structural/dynamic verifier | 6 logins, NOINHERIT, NOBYPASSRLS, no memberships | Yes |
| RLS | Structural verifier | 15 tables with ENABLE + FORCE | Yes |
| Policies | Structural verifier | Exactly 29 | Yes |
| Grants | Structural verifier | 58 exact unit grants / 29 role-table pairs | Yes |
| API auth | Integration | Invalid key 401; valid tenant list 200 | Yes |
| Tenant isolation | Integration | Tenant A cannot read Tenant B scan | Yes |
| Transactional outbox | Integration | API request persists a PENDING outbox row without Service Bus | Yes |
| Worker | Integration | Real `bevoac_worker` persists controlled FAILED/REFUNDED state without cloud calls | Yes |
| Public API identity | Azure smoke | `public_api`, `bevoac_api`, `pg-api-password`, no SB env | Yes |
| Worker identity | Azure smoke | `bevoac_worker`, worker UAMI, MI Service Bus | Yes |
| Outbox identity | Azure smoke | `bevoac_outbox`, outbox UAMI, Sender role | Yes |
| Retention identity | Azure smoke | `bevoac_retention`, retention UAMI | Yes |
| Admin API | Azure smoke | Internal ingress, OIDC, `bevoac_admin_api` | Yes |
| Workload phase | Terraform | No unapproved destruction | Yes |
| Candidate | Direct smoke | Health 200, invalid key 401, valid tenant list 200 | Yes |
| Queue/outbox | Release health | Sessions enabled, DLQ 0, no old backlog | Yes |
| Traffic | Rollout | 5% → 25% → 100%, each stage green | Yes |
| Final network | Security smoke | Key Vault/PostgreSQL private | Yes |
| Service Bus | Security smoke | Local auth disabled; legacy secret absent | Yes |
| Legacy RBAC | Security smoke | API no Sender; API/worker no vault-wide reader | Yes |
| Documentation | Review | Runbook and evidence reflect actual deployed state | Yes |
| External assurance | Pentest / restore / load | Required before certification-style claims | According to governance |
