# Comparatif Runbook V5.3 rebase V4.2 vs V6.1.1 final

## Objectif

Cette note compare le runbook V5.3 rebase V4.2, qui faisait 35 pages et contenait une structure client-ready avec schémas, au runbook V6.1.1 précédent, qui était trop court et moins lisible, puis au runbook V6.1.1 final livré dans ce package.

## Synthèse

| Axe | V5.3 rebase V4.2 | V6.1.1 précédent | V6.1.1 final |
|---|---|---|---|
| Longueur | 35 pages | 28 pages | 46 pages rendues |
| Schémas intégrés | Oui, pages architecture/onboarding/scan/tenant/outbox/APIM/KV/observabilité/déploiement | Sources Mermaid surtout textuelles, rendu faible | 10 schémas rendus + sources Mermaid maintenables |
| Design | Tables bleu foncé, notes, code boxes, header/footer | Trop simple | Reprise du style client-ready : tables bleues, notes, code boxes, header/footer |
| From scratch | Détaillé | Trop condensé | Détaillé et mis à jour V6.1.1 |
| V6 KPI | Non applicable | Présent mais trop court | Intégré dans modules, JSON, PDF, tests |
| Tests admin/client | Présents V5.3 | Présents mais compressés | Repris de bout en bout avec commandes et attendus |
| Troubleshooting | Présent | Partiel | Enrichi avec toutes les erreurs rencontrées |
| GO / NO-GO | Présent | Présent | Mis à jour V6.1.1 avec backfill, receiver, executionStatus, PDF KPI |

## Décision documentaire

Le runbook final doit remplacer le runbook V6.1.1 précédent. Les runbooks V4.2/V5.2/V5.3 restent des références historiques mais ne doivent pas être utilisés comme document actif client après publication du runbook V6.1.1 final.
