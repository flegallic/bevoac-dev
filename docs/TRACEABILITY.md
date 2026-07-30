# Traçabilité V6.1.2-R3 / V6.1.3

## Source

| Référence | Portée | Statut |
|---|---|---|
| `f01945f...` | baseline runtime-role hardening | historique validé |
| `f37c066` | suppression de `app.service_context` | poussé et testé |
| `d542684381c0120f6b9e95e02bc97c1cce355712` | documentation R3 / source export V6.1.2 | baseline d’entrée V6.1.3 |
| V6.1.3 | runtime/IaC/CI/provider boundary | release candidate à accepter |

## Preuve PostgreSQL jetable

| Contrôle | Résultat |
|---|---:|
| PostgreSQL | 16.14 |
| Migrations | 8 |
| Tables publiques | 16 |
| Tables RLS forcées | 15 |
| Policies | 29 |
| Privilèges unitaires | 58 |
| Couples rôle/table | 29 |
| Logins réels testés | 6 |
| Memberships runtime | 0 |
| Données temporaires persistantes | 0 |

Cette preuve démontre le modèle. V6.1.3 la rejoue en CI et exige la même structure sur PostgreSQL Azure avant promotion.

## Refactoring V6.1.3

- API/worker versionnés `6.1.3-production-ready`;
- identité PostgreSQL par workload;
- outbox et rétention sur identités dédiées;
- administration dans un runtime interne;
- scaler Service Bus worker par Managed Identity;
- migration en deux phases pour préserver le rollback;
- intégrations API/worker sur PostgreSQL réel sans appels cloud;
- adapter provider V1, AWS/GCP fail-closed.

## Preuve live requise

L’état enterprise n’est validé qu’après archivage des éléments suivants : commit et digests d’images, plans Terraform, huit migrations, six utilisateurs réellement câblés, identités/RBAC, Key Vault/PostgreSQL privés, Service Bus local auth désactivé, APIM, santé candidat, trafic 5/25/100, rollback, backlog/DLQ et smoke métier.
