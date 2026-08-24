# Release validation Bevoac V6.2.0

## Static and CI

```bash
./validate_release.sh --structure-only
./validate_release.sh --full
```

The full gate requires Node.js 24, Terraform 1.14.7 and dependency access.

## Mandatory evidence

- immutable source commit and artifact SHA;
- API/worker/frontend-demo build results;
- unit, integration, contract and tenant-isolation tests;
- PostgreSQL migration and RLS verification;
- Terraform fmt/validate/static policy;
- SBOM, SCA, SAST, secret and image scans;
- APIM direct-versus-gateway tests;
- diagnostics and notification test;
- restore drill;
- load and resilience tests;
- real-tenant acceptance;
- rollback rehearsal.

## NO-GO

- cross-tenant result;
- direct backend bypass;
- restore failure;
- missing alert delivery;
- unbounded partial Azure inventory;
- critical/high unaccepted security finding;
- non-repeatable migration;
- missing rollback or evidence.

## State Terraform sensible

Avant tout plan ou apply, confirmer que le backend de state de production est chiffré, soumis au moindre privilège, journalisé et absent de tout package ou artefact de preuve. Le jeton APIM généré par `random_password` est présent dans le state. Une copie locale, un `terraform.tfstate`, un plan binaire ou une sortie non expurgée ne doit jamais être ajouté au dépôt ni transmis dans l’evidence pack. En cas d’exposition, bloquer la release et faire tourner le jeton APIM avant reprise.
