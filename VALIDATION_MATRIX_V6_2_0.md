# Bevoac V6.2.0 validation matrix

| Domain | Gate | Required result | Evidence | Blocking |
|---|---|---|---|---:|
| Source | canonical validator | exit 0 | validator report | Yes |
| Source | secret/documentation gate | exit 0 | source gate log | Yes |
| API | install/check/tests | all pass on Node 24 | CI artifact | Yes |
| Worker | install/check/tests | all pass on Node 24 | CI artifact | Yes |
| Frontend | demo-only typecheck/build | pass; no browser credential storage | CI artifact | Yes |
| PostgreSQL | from-scratch PG16 | 9 migrations and exact expectations | DB gate | Yes |
| Tenant isolation | API + RLS runtime | tenant A cannot access tenant B | integration report | Yes |
| Idempotency | same/different request | replay / deterministic 409 | integration report | Yes |
| Worker | failure taxonomy | retry/complete/dead-letter correct | integration report | Yes |
| Azure catalog | completeness | every registered module preflighted | tests | Yes |
| Resource Graph | pagination | >1000 rows or visible truncation | tests | Yes |
| APIM | backend boundary | direct denied; APIM accepted | live smoke | Yes |
| HTTP | schemas/headers/cache | invalid input 400; no-store; headers | integration report | Yes |
| Config | production fail-closed | TLS, MI, OIDC, runtime separation | tests | Yes |
| Onboarding | state/redirect | opaque state; replay rejected; safe fragment | tests/live | Yes |
| Terraform | fmt/init/validate | exit 0 | CI artifact | Yes |
| IaC policy | static/Trivy | no unapproved high/critical finding | CI artifact | Yes |
| Monitoring | diagnostics/action group/alerts | resources present | live evidence | Yes |
| Alerting | notification | receiver confirms test | signed evidence | Yes |
| Secrets | rotation | all production secrets rotated/tested | rotation report | Yes |
| Service Bus | Entra-only | local auth disabled; SAS absent | live evidence | Yes |
| Restore | PITR drill | data/RLS verified; RPO/RTO measured | restore report | Yes |
| Load | multi-tenant | accepted thresholds, no unexplained DLQ | load report | Yes |
| Security | review/pentest | no unresolved critical; highs controlled | report | Yes |
| Client acceptance | real tenant | read-only scan and offboarding accepted | signed report | Yes |
| Documentation | V6.2 corpus | links/versions/claims consistent | docs gate | Yes |
| Rollback | rehearsal | accepted prior revision recoverable | rollback report | Yes |
| Release | evidence pack | complete hashes and approvals | index | Yes |

A source row marked implemented is not production proof. Production GO requires every blocking row to be green.
