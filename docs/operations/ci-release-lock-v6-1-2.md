# CI et Release Lock V6.1.2

## But

Empêcher qu'une modification casse les privilèges PostgreSQL, l'isolation tenant, les contrats ou l'IaC.

## Jobs minimaux

1. API : `npm ci`, check, 44+ tests.
2. Worker : `npm ci`, check, tests.
3. Contrats : synchronisation API/worker.
4. PostgreSQL 16 éphémère : bootstrap, huit migrations, six rôles, RLS, grants.
5. Denial tests : connexions réelles des six logins.
6. Test applicatif : `Fastify.inject()` avec `bevoac_api`, tenant A/B, 401/404.
7. Test worker : transport simulé, DB réelle, aucune connexion Azure.
8. Terraform : fmt, init backend=false, validate, checks statiques.
9. Supply chain : secret scan, SCA, SBOM, image scan, IaC scan.

## Propriétés de la DB CI

- créée au début du job ;
- données fictives uniquement ;
- détruite à la fin ;
- aucun accès Azure ou production ;
- aucune dépendance au `.env` du développeur.

## Gate

Aucun artefact de release n'est publié si un job échoue.
