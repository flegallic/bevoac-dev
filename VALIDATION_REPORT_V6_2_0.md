# Bevoac V6.2.0 — Rapport de validation du source consolidé R2

**Baseline V6.1.3 :** `d9b85ad728a9f1252ca2acd0b9421cd5ec9a7ba4`  
**Archive baseline SHA-256 :** `f2448c3a71e05fc06e95457fa59035f3b4e7512c9085162ff026f5a4f091a588`  
**Candidat :** `6.2.0-client-ready-controlled-production`

## Résultats exécutés dans l’environnement de construction

| Contrôle | Résultat |
|---|---:|
| Validateur structurel V6.2 | **OK** |
| Source/security/documentation gate | **OK** |
| Résolution des imports relatifs | **273 imports — OK** |
| Secret-pattern scan | **OK**, aucune valeur affichée |
| Hardening IaC statique | **OK** |
| Tests Python du validateur de plans | **10/10** |
| Références Terraform statiques | **26 fichiers, 84 variables, 107 blocs — OK** |
| Parsing JSON | **21 fichiers — OK** |
| Validation métaschéma JSON Schema | **5 schémas — OK** |
| Syntaxe Python | **10 fichiers — OK** |
| Parsing YAML | **2 fichiers — OK** |
| Parsing TypeScript/TSX | **10 fichiers — OK** |
| Syntaxe JavaScript | **187 fichiers — OK** |
| Syntaxe Bash | **26 fichiers — OK** |
| Tests JavaScript V6.2 ciblés | **99 total, 98 réussis, 1 ignoré, 0 échec** |
| `git diff --check` | **OK** |

Le test ignoré concerne le chargement dynamique de la registry Azure lorsque les SDK Azure ne sont pas installés dans l’environnement statique. La cohérence du catalogue est également contrôlée par les catalogues JSON synchronisés, le synchroniseur, le validateur source et les tests sans SDK. Le test runtime complet reste obligatoire dans la CI Node.js 24 avec les dépendances installées.

## Portée des tests locaux

Les tests locaux couvrent notamment :

- contexte tenant API et worker ;
- destruction d’une connexion PostgreSQL défaillante ;
- fingerprint d’idempotence et conflit 409 ;
- schémas HTTP et UUID ;
- configuration fail-closed ;
- frontière APIM ;
- state onboarding chiffré/authentifié ;
- page de résultat sans identifiant durable ;
- catalogue de modules/preflight ;
- pagination Resource Graph au-delà de 1 000 lignes ;
- statut partiel explicite pour RBAC et Private Link lorsqu’une troncature suit une analyse réelle ;
- `markRejectedMessage`, remboursement et dead-letter atomiques pour un contrat invalide identifiable ;
- abandon si la persistance d’un rejet invalide échoue ;
- compteur de delivery Service Bus traité comme un compteur commençant à 1 ;
- erreurs retryables, abandon, dead-letter après épuisement ;
- provider déclaré mais non actif : persistance terminale puis dead-letter ;
- ownership des tentatives et prévention des écritures obsolètes ;
- sanitization des résultats et résumés ;
- timeout/annulation ;
- frontend et page statique DEMO ONLY sans stockage ni collecte de clé ;
- résolution des imports relatifs JavaScript/TypeScript.

## Contrôles non exécutés dans cet environnement

- installation et suites complètes sous Node.js 24 ;
- build/typecheck frontend avec toutes les dépendances ;
- PostgreSQL 16/RLS ;
- Terraform `fmt/init/validate/plan` ;
- Docker et scan d’images ;
- smoke Azure APIM/direct ;
- notification d’alerte ;
- rotation de secrets ;
- transition Service Bus Managed Identity-only ;
- restore drill ;
- charge ;
- pentest ;
- acceptation tenant réel ;
- rollback live.

Ces éléments sont des gates de promotion, pas des correctifs source manquants. Voir `VALIDATION_MATRIX_V6_2_0.md` et `RELEASE_CANDIDATE_LIMITATIONS.md`.

## Verdict source

```text
TEN_PRIORITY_FINDINGS_SOURCE_INTEGRATED=true
RELEASE_STATIC_VALIDATION_OK=true
SOURCE_SECURITY_GATE_OK=true
LOCAL_STATIC_VALIDATION_OK=true
SOURCE_PACKAGE_PRODUCTION_ACCEPTED=false
FULL_NODE24_DEPENDENCY_TESTS_EXECUTED=false
FRONTEND_DEPENDENCY_BUILD_EXECUTED=false
TERRAFORM_VALIDATE_EXECUTED=false
POSTGRESQL_INTEGRATION_EXECUTED=false
LIVE_AZURE_SMOKE_EXECUTED=false
NEXT_REQUIRED_PROOF=NODE24_POSTGRES_TERRAFORM_AZURE_AND_CLIENT_GATES
```
