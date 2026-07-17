# Matrice de validation Bevoac enterprise hardening

| Domaine | Commande | Attendu | Bloquant |
|---|---|---|---|
| Syntaxe API | `cd bevoac-api-enterprise && npm run check` | Exit 0 | Oui |
| Tests API | `cd bevoac-api-enterprise && npm test` | Exit 0 | Oui |
| DB baseline | `npm run migrate-db` sur DB vide | Tables/contraintes finales creees | Oui |
| Hardening DB/API | `npm run check:enterprise-hardening` | Tous les checks OK | Oui |
| RLS stricte | `ALLOW_ENTERPRISE_RLS_APPLY=true npm run migrate-db:enterprise-rls` | RLS appliquee | Oui avant prod enterprise |
| Isolation tenant | `npm run check:tenant-isolation:enterprise` | Acces croise refuse | Oui avant prod enterprise |
| Worker syntaxe | `cd bevoac-worker-enterprise && npm run check` | Exit 0 | Oui |
| Worker tests | `cd bevoac-worker-enterprise && npm test` | Exit 0 | Oui |
| IaC format | `terraform fmt -recursive` | Pas de diff inattendue | Oui |
| IaC validate | `terraform init -backend=false && terraform validate` | Exit 0 | Oui |
| APIM hardening | `bash scripts/static-hardening-check.sh` | OK | Oui |
| PDF | Generation `/v1/scans/:id/pdf` | PDF lisible, KPI + evidence | Oui |
| JSON | `/v1/scans/:id` sans includeResult | Pas de JSON brut | Oui |
| JSON brut | `/v1/scans/:id/result` | Resultat complet explicite | Oui |
| Scopes | API key sans `scan:result:read` | Acces resultat refuse | Oui |
| AWS readiness | Revue `docs/MULTICLOUD_AWS_FOUNDATION.md` | Interfaces pretes, AWS non active par erreur | Oui |
