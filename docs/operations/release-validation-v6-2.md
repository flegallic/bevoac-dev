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

## Backend Terraform autoritatif V6.2

Le backend de production autoritatif est `stbevoacprodtfstate` / `tfstate` / `bevoac-prod.tfstate` dans `rg-bevoac-tfstate-prod`.

Avant tout `plan` ou `apply` de production : confirmer le tenant et la souscription Azure attendus; utiliser Microsoft Entra ID et jamais une Shared Key ou un SAS; confirmer l'existence du blob autoritatif; initialiser Terraform avec `-reconfigure`; utiliser uniquement un plan sauvegarde et qualifie avant tout apply; ne jamais substituer un state local au backend autoritatif.

Les jobs CI de syntaxe et de politique restent isoles de la production via `terraform init -backend=false`.

A l'etablissement du backend V6.2, le state distant qualifie avait la lineage `3662523a-e219-ec52-7da1-6421cd34b073`, le serial `851`, 91 adresses dont 89 ressources managees et 2 data sources. Le full plan de qualification a produit zero action Terraform. Le seul drift de lecture accepte concernait `azurerm_api_management.gateway[0]`, sans action planifiee.

Une variation d'ETag, `Last-Modified` ou `versionId` n'est pas a elle seule une preuve de modification fonctionnelle du state, car le verrouillage AzureRM utilise egalement les metadonnees du blob.
