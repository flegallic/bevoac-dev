# Bevoac V6.2.0 — Matrice de fermeture des dix constats prioritaires

**Baseline :** V6.1.3 `d9b85ad728a9f1252ca2acd0b9421cd5ec9a7ba4`  
**Candidat :** `6.2.0-client-ready-controlled-production`

Cette matrice distingue :

- **intégré dans la source** : le correctif est présent dans le code consolidé ;
- **validé localement** : syntaxe, contrôles statiques ou tests sans dépendances externes exécutés ;
- **preuve CI/live obligatoire** : le correctif doit encore être prouvé dans Node.js 24, PostgreSQL, Terraform ou Azure avant la promotion production.

| # | Constat | Correctif intégré | Fichiers principaux | Tests/contrôles | Statut source | Preuve de promotion restante |
|---:|---|---|---|---|---|---|
| 1 | Validateur officiel incohérent | Validateur canonique V6.2, wrapper V6.1.3, vérification du secret Service Bus conditionnel et du modèle Key Vault actif | `validate_release.sh`, `scripts/release/validate_v6_2_0.py`, `scripts/release/validate_v6_1_3.py` | structure validator, hardening IaC | **FERMÉ DANS LA SOURCE** | CI complète V6.2 |
| 2 | Mauvais commit et mauvais SHA | Baseline cryptographique corrigée et déclarée dans les contrôles de release | `PACKAGE_AUDIT_REPORT.md`, `SOURCE_BASELINE.json`, `docs/TRACEABILITY.md` | marqueurs validator, manifeste du package | **FERMÉ DANS LA SOURCE** | SHA du ZIP final et commit de release |
| 3 | Nettoyage du contexte tenant PostgreSQL | Contexte transaction-local, rollback, destruction du client en cas de panne de connexion ou rollback impossible | API/worker `src/lib/db-context.js` | API et worker `db-context-v620.test.js` | **FERMÉ DANS LA SOURCE** | intégration PostgreSQL 16 et RLS |
| 4 | Contournement possible d’APIM | Secret backend rotatable, injection APIM, vérification constante côté API, accès direct refusé hors exemptions minimales | plugin/lib APIM API, `v620-apim-backend-boundary.tf`, policy APIM | `apim-boundary-v620.test.js`, static IaC | **FERMÉ DANS LA SOURCE** | Terraform validate/plan et smoke direct/APIM |
| 5 | Idempotence non liée au contenu | Canonicalisation + SHA-256, persistance du fingerprint, replay identique, HTTP 409 si demande différente | `canonical-json.js`, `scan-service.js`, migration V6.2 | `idempotency-fingerprint-v620.test.js` | **FERMÉ DANS LA SOURCE** | intégration/race PostgreSQL |
| 6 | Modules absents du resource preflight | Catalogue unique API/worker avec scope et indicateur de preflight pour tous les modules Azure | deux `contracts/module-catalog.json`, loaders, preflight | tests catalogues API/worker | **FERMÉ DANS LA SOURCE** | suite worker complète avec SDK Azure |
| 7 | Resource Graph limité à 1 000 résultats | Pagination `skipToken`, limites pages/lignes, détection token répété, preuve de troncature et statut `PARTIAL` lorsque RBAC/Private Link ont déjà analysé des ressources | `resource-graph.js`, evidence helper, `status-semantics.js`, scanners concernés | pagination > 1 000, truncation, tags, status semantics | **FERMÉ DANS LA SOURCE** | test grand tenant Azure |
| 8 | Erreurs transitoires worker rendues terminales | Taxonomie retryable/terminal, compteur de delivery one-based, abandon, dead-letter après épuisement, persistance/refund d’un contrat invalide identifiable, abandon si cette persistance échoue, provider non activé terminalisé en DLQ, billing conservé pendant retry et erreurs client expurgées | `worker-errors.js`, `message-processor.js`, `scan-store.js`, migration | retry processor, invalid-message rejection, provider boundary, ownership, sanitizer, timeout | **FERMÉ DANS LA SOURCE** | intégration Service Bus et tests de panne |
| 9 | Validation HTTP et configuration non fail-closed | Schémas Fastify stricts, bornes, TLS PG, Managed Identity par défaut, admin OIDC, runtime séparé, headers/no-store, onboarding opaque | routes, configs API/worker, plugins security/admin, onboarding | tests config/schema/headers/onboarding | **FERMÉ DANS LA SOURCE** | suites Node 24, startup prod et smoke Azure |
| 10 | Frontend démonstrateur présenté comme portail | Next.js et page statique classés **DEMO ONLY**, aucun stockage de clé, proxy retiré/410, aucun fallback live fictif, déploiement prod interdit | frontend, Docker/deploy, template statique IaC, precondition V6.2 | source gate, static hardening, type parsing | **FERMÉ DANS LA SOURCE** | build/typecheck Node 24 |

## Définition de fermeture de release

La fermeture source de ces dix constats ne constitue pas à elle seule le GO production. La release V6.2.0 requiert encore les preuves bloquantes listées dans `VALIDATION_MATRIX_V6_2_0.md`, notamment :

- Node.js 24 et dépendances complètes ;
- PostgreSQL 16/RLS ;
- Terraform `fmt/init/validate/plan` ;
- smoke APIM/direct ;
- alertes réelles ;
- rotation ;
- restore drill ;
- charge ;
- revue sécurité/pentest ;
- acceptation tenant client ;
- rollback et evidence pack.
