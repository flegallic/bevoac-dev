# Retention et suppression Bevoac V5.1

## 1. Objectif

Documenter le script de retention disponible et clarifier que l'automatisation doit etre confirmee par deploiement.

## 2. Script disponible

```text
bevoac-api-enterprise/scripts/retention-sweep.js
```

Fonctions:

- suppression des scans `DONE` plus anciens que `SCAN_RESULT_RETENTION_DAYS`;
- suppression des scans `FAILED` plus anciens que `FAILED_SCAN_RETENTION_DAYS`;
- purge des entrees `scan_request_idempotency` anciennes;
- purge des sessions onboarding anciennes;
- journalisation dans `retention_audit_log`.

## 3. Dry-run

```bash
cd bevoac-api-enterprise
DRY_RUN=true node scripts/retention-sweep.js
```

## 4. Execution reelle

```bash
DRY_RUN=false SCAN_RESULT_RETENTION_DAYS=180 FAILED_SCAN_RETENTION_DAYS=90 node scripts/retention-sweep.js
```

## 5. Statut V5.1

Formulation correcte:

> Bevoac fournit un script de retention auditable. Son automatisation doit etre configuree et verifiee dans l'environnement cible.

Formulation interdite:

> La retention est automatiquement executee en production.

Sauf si un scheduler est effectivement deployee et verifie.

## 6. Automatisation recommandee avant pilote avance

Options:

- Azure Container Apps Job planifie;
- Azure Automation depuis reseau prive;
- runner prive dans VNet;
- pipeline CI/CD controle.

Criteres d'acceptation:

- planification documentee;
- logs d'execution;
- entree dans `retention_audit_log`;
- dry-run disponible;
- procedure rollback/incident;
- preuve exportable pour audit interne.
