# Bevoac V6.2.0 — preuve de validation source consolidée R2

## Identité du candidat

- Version produit : `6.2.0-client-ready-controlled-production`.
- Baseline immuable : commit V6.1.3 `d9b85ad728a9f1252ca2acd0b9421cd5ec9a7ba4`.
- SHA-256 de l’archive baseline : `f2448c3a71e05fc06e95457fa59035f3b4e7512c9085162ff026f5a4f091a588`.
- Statut : source consolidée et remédiée ; non déployée et non acceptée en production à ce stade.

## Validation exécutée dans l’environnement de livraison

La validation sans dépendance externe contrôle au minimum :

```text
RELEASE_STATIC_VALIDATION_OK=true
DOCS_GATE_OK=true
SECRET_PATTERN_SCAN_OK=true
RELATIVE_IMPORT_GATE_OK=true
SOURCE_SECURITY_GATE_OK=true
LOCAL_STATIC_VALIDATION_OK=true
```

Résultats consolidés :

```text
SOURCE_RELEASE_FILE_COUNT=657
RELATIVE_IMPORTS_CHECKED=273
PYTHON_IAC_TESTS=10/10
JSON_PARSE_COUNT=21
JSON_SCHEMA_META_VALIDATION_COUNT=5
PYTHON_SYNTAX_COUNT=10
YAML_PARSE_COUNT=2
TYPESCRIPT_PARSE_COUNT=10
JS_SYNTAX_COUNT=187
SHELL_SYNTAX_COUNT=26
NODE_TESTS_TOTAL=99
NODE_TESTS_PASSED=98
NODE_TESTS_SKIPPED=1
NODE_TESTS_FAILED=0
```

## Comportements critiques couverts

- contexte PostgreSQL tenant limité à la transaction et éviction du client si le nettoyage devient ambigu ;
- idempotence liée au contenu par fingerprint canonique ;
- schémas HTTP stricts et configuration production fail-closed ;
- frontière APIM authentifiée ;
- state onboarding chiffré et authentifié ;
- catalogue des modules synchronisé ;
- pagination Resource Graph au-delà de 1 000 lignes ;
- statut `PARTIAL` lorsque des ressources ont été analysées avant troncature ;
- taxonomie des erreurs worker retryables et terminales ;
- `markRejectedMessage` persiste et rembourse un message invalide avant dead-letter lorsque l’identité est sûre ;
- échec de persistance d’un rejet invalide entraîne un abandon, pas une perte silencieuse ;
- le `Service Bus delivery count` est traité comme un compteur commençant à 1 ;
- provider déclaré mais non activé : acquisition, persistance terminale et dead-letter ;
- tentative worker obsolète incapable d’écraser résultat ou billing ;
- timeout et propagation d’`AbortSignal` ;
- redaction des résultats et erreurs ;
- frontend explicitement DEMO ONLY, sans stockage de credential navigateur ;
- résolution de chaque `relative import` littéral dans le code JavaScript/TypeScript actif.

## Gates non exécutées dans l’environnement de livraison

Restent obligatoires avant promotion :

- `npm ci`, checks et tests complets sous Node.js 24 ;
- build/typecheck frontend avec ses dépendances ;
- PostgreSQL 16, migrations, rôles runtime et RLS ;
- Terraform `fmt`, `init -backend=false`, `validate` et plan de production revu ;
- smoke APIM versus accès direct ;
- diagnostics Azure, Action Group et test de notification ;
- transition Service Bus Managed Identity-only et retrait de l’authentification locale ;
- rotation des secrets ;
- restore drill avec RPO/RTO ;
- charge, pentest, acceptation du tenant réel et répétition du rollback.

La validation source ne remplace pas ces preuves. Elles doivent être liées au commit candidat final, aux digests d’images, au SHA-256 du plan Terraform, à l’environnement et à l’horodatage.
