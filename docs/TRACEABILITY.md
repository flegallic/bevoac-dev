# Traceabilite du runbook Bevoac V5.2 ultime

## Sources consolidees
- Runbook_Bevoac_V4_2_Production_Ready.docx
- Runbook_Bevoac_V5_Production_Ready_Complet.source.docx
- Runbook_Bevoac_V5_2_Production_Ready_Complet.docx

## Decisions de consolidation
- Restaurer la granularite operationnelle V4.2.
- Conserver les ajouts V5.1: Service Bus sessions, scan_results, OIDC admin, DLQ, private endpoints, mermaid sources.
- Integrer les corrections V5.2 confirmees: idempotency server-generated, transactional outbox, migrations versionnees, billing reserved/consumed/refunded, retry/backoff, retention job, alerting, APIM optionnel, workflow CI.
- Reintroduire des schemas visuels et les sources Mermaid correspondantes.
- Ajouter un troubleshooting issu des erreurs rencontrees pendant la recette: Key Vault ForbiddenByConnection, APIM 404 operations, APIM subscription key, Service Bus namespace FQDN, alert DLQ aggregation, retention HCL, billingState nested.

## Artefacts
- Runbook_Bevoac_V5_2_Production_Ready_Ultime.docx
- Comparatif_Runbooks_Bevoac_V4_2_V5_1_V5_2.docx
- docs/mermaid/*.mmd
- docs/diagrams/*.png
- sources/*.docx

## Verification locale effectuee
- Generation DOCX OK.
- Rendu DOCX -> PNG/PDF OK via LibreOffice headless.
- Inspection visuelle contact sheet OK, pas de page blanche ou schema coupe dans la version finale.
