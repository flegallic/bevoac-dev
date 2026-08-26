# Operations runbook Bevoac V6.2.0

## Required tools

- Node.js 24;
- Terraform 1.14.7;
- Azure CLI;
- PostgreSQL client for controlled DB operations;
- access through named operator identities.

## Normal operation

1. Check API liveness/readiness.
2. Check Service Bus active and dead-letter counts.
3. Check outbox age and scan age.
4. Check PostgreSQL CPU, storage and connections.
5. Check Action Group and alert status.
6. Review expiring secrets.

## Deployment discipline

```text
READ_ONLY -> CODE_ONLY -> TEST -> PLAN_ONLY -> APPROVAL -> APPLY -> VERIFY -> EVIDENCE
```

Never combine a database migration, network change, secret rotation and major runtime refactor in one change window.

## Release profile

Use `release/v6.2.0-controlled-production.tfvars.example` only as a template. Real values belong in a protected operator file and are never committed.

## Rollback

- preserve the previous healthy Container Apps revision;
- do not retire compatibility resources until smoke and traffic promotion succeed;
- database migrations are additive;
- if health, billing, outbox, DLQ or tenant isolation fail, stop rollout and return traffic to the prior revision.

## Frontend

Do not position the bundled frontend as a customer portal. Its deployment requires an explicit demo-only confirmation.
## Azure onboarding user interface

Use the authenticated API workflow. The API-hosted `/v1/onboarding/azure/result` page requests no credential and displays no tenant data. `deploy_onboarding_frontend` must remain `false` in controlled production. The historical static page is a non-interactive DEMO-ONLY explanation page.

## Contrat de message invalide

Lorsque `scanId` et `tenantId` sont des UUID sûrs mais que le contrat du message est invalide, le worker terminalise atomiquement le scan `PENDING`, enregistre un résultat client expurgé, rembourse la réservation, inscrit une tentative `DEAD_LETTERED`, puis place le message en DLQ avec la raison `INVALID_SCAN_REQUEST`. Si la persistance échoue, le message est abandonné afin de préserver la possibilité de cohérence ultérieure. Un message sans identité sûre est directement placé en DLQ sans tentative de mutation DB.

## Backend Terraform autoritatif de production

Le state Terraform de production est centralise dans un backend Azure Storage dedie. Le stockage historique du frontend ne doit jamais etre utilise pour le state Terraform.

Configuration autoritative :

- Resource Group : `rg-bevoac-tfstate-prod`
- Storage Account : `stbevoacprodtfstate`
- replication : `Standard_ZRS`
- container prive : `tfstate`
- cle de state : `bevoac-prod.tfstate`
- authentification : Microsoft Entra ID uniquement
- Shared Key : desactivee
- acces blob anonyme : desactive
- HTTPS obligatoire et TLS minimum 1.2
- versioning Blob : active
- soft-delete Blob et container : 30 jours
- RBAC operateur : `Storage Blob Data Contributor` au scope du container

Le state distant a ete etabli a partir du checkpoint de reconstruction `014-after-targeted-convergence-apply.tfstate`. La lineage Terraform conservee est `3662523a-e219-ec52-7da1-6421cd34b073`; le premier state distant qualifie porte le serial `851`. Le checkpoint 014 reste une preuve historique locale et n'est plus le state de travail autoritatif.

Pour une execution locale de production, l'operateur doit etre authentifie avec Azure CLI sur le tenant et la souscription attendus. `scripts/release/release_v6_2_0.sh` valide ce contexte, confirme l'existence du blob de state et initialise le backend avec `terraform init -reconfigure`. Le backend utilise Microsoft Entra ID; aucune Access Key ou SAS du Storage Account ne doit etre utilisee.

Les Enterprise Gates statiques conservent `terraform init -backend=false`. Elles valident donc la syntaxe et les politiques IaC sans acces au state de production. Un futur workflow de plan/apply devra utiliser une identite dediee avec federation OIDC et RBAC minimal sur le backend.

Le state Terraform est sensible. `terraform.tfstate`, ses sauvegardes, les copies du state distant, `.terraform/` et les plans binaires non qualifies ne doivent jamais etre ajoutes au depot ou a un evidence pack.

Le backend AzureRM utilise un lease Azure Blob et stocke temporairement les informations de verrouillage dans les metadonnees du blob. `ETag`, `Last-Modified` ou `versionId` peuvent donc varier pendant un plan verrouille sans modification semantique du state. La qualification doit s'appuyer sur le contenu du plan, la lineage, le serial et, si necessaire, une comparaison semantique du state.

La suppression manuelle du blob, son remplacement ou un `terraform state push` ne font pas partie de la procedure normale de release.
