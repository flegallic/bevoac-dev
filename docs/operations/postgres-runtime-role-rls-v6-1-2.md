# PostgreSQL Runtime Roles et RLS V6.1.2

## Modèle

L'autorisation globale repose sur le login PostgreSQL réel. `app.current_tenant_id` sélectionne le tenant, mais ne donne aucun droit à lui seul.

## Rôles

| Rôle | Portée |
|---|---|
| `bevoac_api` | opérations tenant-scoped de l'API publique |
| `bevoac_worker` | scans/résultats/tentatives/billing tenant-scoped |
| `bevoac_outbox` | outbox globale SELECT/UPDATE |
| `bevoac_retention` | purge globale bornée et audit |
| `bevoac_admin_api` | billing global borné et audit insert-only |
| `bevoac_operator` | provisioning contrôlé |

## Preuve validée sur PostgreSQL 16.14 jetable

- 15 tables avec RLS activée et forcée ;
- 29 policies ;
- 58 privilèges unitaires ;
- 29 couples rôle/table ;
- 0 membership runtime ;
- six connexions réelles et denial tests ;
- 0 donnée temporaire persistante.

## Interdit

- réintroduire `app.service_context` ;
- exécuter les anciens lanceurs enterprise RLS ;
- utiliser `bevoacadmin` comme compte runtime ;
- accorder `BYPASSRLS` à un workload.

## Etat production

L'application finale de la migration runtime-role sur PostgreSQL Azure doit être prouvée en staging puis en production. La validation jetable n'est pas une preuve de déploiement Azure.
