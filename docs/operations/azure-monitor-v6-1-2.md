# Observabilité et alerting V6.1.2

## Signaux obligatoires

| Signal | Source | Condition |
|---|---|---|
| API 5xx | Container Apps / Log Analytics | hausse soutenue |
| Outbox pending age | PostgreSQL / logs | événement ancien |
| Outbox failed | PostgreSQL | > 0 persistant |
| Service Bus backlog | Azure Monitor | croissance sans rattrapage |
| DLQ | Azure Monitor | > 0 |
| Worker failures | logs + `scan_attempts` | erreurs répétées |
| PostgreSQL CPU/memory/storage | Azure Monitor | seuils approuvés |
| Scans PENDING anciens | SQL | dépassement SLO |
| Billing divergence | SQL / app | état incohérent |

## Point à confirmer

Le dernier output Terraform transmis expose `monitor_action_group_id=""`. L'existence d'un Action Group actif et de receivers doit être revalidée live.
