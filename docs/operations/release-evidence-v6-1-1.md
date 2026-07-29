# Bevoac V6.1.1 - Release evidence

## Statut

Document de preuves a completer et archiver pour chaque release V6.1.1.

## Versions attendues

| Composant | Version / tag |
|---|---|
| API | `bevoac-api-enterprise:v6.1.2` |
| Worker | `bevoac-worker-enterprise:v6.1.2` |
| Contrat scan | `2026-06-01-kpi-modules-v6` |
| Runbook actif | `Runbook_Bevoac_V6_1_1_Production_Ready_Client_B2B` |

## Evidence checklist

| Domaine | Commande | Evidence attendue | Statut |
|---|---|---|---|
| API check | `npm run check` | runtime deps, syntax, contracts OK | A completer |
| API tests | `npm test` | fail 0 | A completer |
| Worker check | `npm run check` | syntax OK | A completer |
| Worker tests | `npm test` | fail 0 | A completer |
| Terraform | `terraform validate` | configuration valid | A completer |
| Static IaC | `bash scripts/static-hardening-check.sh` | APIM/DLQ/outbox/retention OK | A completer |
| APIM auth | 401/401/200 | double-auth prouvee | A completer |
| Web scan | `DONE/CONSUMED` | `executionStatus=SUCCESS` | A completer |
| Infra scan | `DONE/CONSUMED` | V6 modules non missing | A completer |
| PDF | `pdftotext` | `1.6 KPI Scorecard` | A completer |
| Service Bus | `az servicebus queue show` | active=0, DLQ=0 | A completer |
| Retention | `az containerapp job execution list` | Succeeded | A completer |
| Alerting | `az monitor action-group show` | receiver enabled | A completer |
| Backfill | `npm run backfill:billing:dry-run` | candidates=0 | A completer |
| RLS | `npm run check:rls` | RLS tenant policy checks passed | A completer |
| Backup/restore | restore drill | serveur restore cree, sanity SQL OK | A completer |

## Resultats valides pendant la recette V6.1.1

- Web scan V6.1.1: `DONE`, `CONSUMED`, `executionStatus=SUCCESS`.
- PDF reel: `PDF document`, 6 pages, `1.6 KPI Scorecard`, `WEB_SECURITY_CHECK_PASS_RATE`.
- Azure Monitor: Action Group `ag-bevoac-prod`, receiver `support@dotcloud.fr`, alertes Service Bus/PostgreSQL activees.
- Backfill billing: 8 anciens scans corriges, dry-run final `candidates=0`.
