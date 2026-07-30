# Documentation Bevoac V6.1.2-R3 / Release V6.1.3

## Baseline active

- **Architecture et exploitation canoniques :** V6.1.2-R3.
- **Release de déploiement :** V6.1.3.
- **Contrat public `/v1` :** inchangé.
- **Provider runtime actif :** Azure uniquement.

Le runbook R3 explique le modèle de sécurité. La documentation V6.1.3 décrit son déploiement contrôlé sur Azure.

## Documents canoniques

- `operations/Runbook_Bevoac_V6_1_2_Production_Enterprise_Ready_R3.docx`
- `operations/Guide_From_Scratch_Bevoac_V6_1_2_R3.docx`
- `operations/Bevoac_V6_1_3_Enterprise_Release_Deployment_Guide.docx`
- `operations/RELEASE_NOTES_V6_1_3.md`
- `technical/architecture-v6-1-2.md`
- `technical/security-model-v6-1-2.md`
- `technical/api-contract-v6-1-2.md`
- `multicloud/MULTICLOUD_READINESS_V6_1_3.md`
- `architecture/ADR-006-runtime-identities-and-provider-boundary.md`
- `TRACEABILITY.md`

## Statuts utilisés

- **IMPLÉMENTÉ DANS LE CODE**
- **VALIDÉ SUR POSTGRESQL JETABLE**
- **POUSSÉ SUR GITHUB**
- **À INDUSTRIALISER EN CI**
- **À VALIDER EN STAGING**
- **À DÉPLOYER EN PRODUCTION**
- **VALIDÉ EN PRODUCTION** uniquement avec preuve live archivée

## Politique d’archives

Les documents historiques sont conservés sous `docs/archive/` ou `docs/archive_source_reference/`. Ils ne constituent pas une procédure active. Les anciennes commandes RLS y sont conservées uniquement pour traçabilité.

## Règle de mise à jour

Une évolution de route, contrat, migration, rôle PostgreSQL, runtime mode, identité managée, flux Service Bus, provider cloud ou variable Terraform impose la mise à jour des documents concernés et de `TRACEABILITY.md`.
