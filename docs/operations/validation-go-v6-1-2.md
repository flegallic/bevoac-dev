# Checklist GO / NO-GO V6.1.2

| Gate | GO |
|---|---|
| Git | commit identifié, PR approuvée |
| API | check et tests verts |
| Worker | check et tests verts |
| CI PostgreSQL | 8 migrations, 6 rôles, denial tests |
| Terraform | validate et plan sans destruction inattendue |
| Azure | images/digests et runtime modes vérifiés |
| PostgreSQL | aucun workload avec `bevoacadmin` |
| RLS | 15 tables forcées, 29 policies, 58 grants |
| APIM | auth et policies testées |
| Outbox/SB | backlog normal, DLQ 0 |
| Scans | web/infra cohérents |
| Billing | RESERVED → CONSUMED/REFUNDED |
| Restore | drill réussi |
| Charge | SLO et isolation respectés |
| Pentest | critiques/hauts traités pour claim enterprise |
