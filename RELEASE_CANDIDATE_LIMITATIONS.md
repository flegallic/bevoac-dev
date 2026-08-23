# Bevoac V6.2.0 R2.2 — Limites de qualification du candidat source

## Validé sur Node.js 24.19.0 dans l’environnement utilisateur

Pour l’API R2.1 :

- `npm ci` ;
- contrôle des dépendances runtime ;
- syntaxe ;
- synchronisation des contrats ;
- 109 tests réussis, 0 échec, 1 test PostgreSQL ignoré ;
- `npm audit` à zéro sur tous les niveaux.

## Validé pendant l’assemblage final direct

- source R2 d’origine et manifeste ;
- structure de release ;
- fichiers sensibles et motifs de secrets ;
- documentation ;
- hardening IaC statique et références Terraform ;
- cohérence des deux lockfiles npm v3, sans modification lors d’un `npm ci --package-lock-only` hors ligne ;
- retrait du SDK Resource Graph déprécié et de la chaîne ms-rest/uuid 8 ;
- transport Resource Graph ARM REST `2024-04-01` ;
- pagination et bornes de couverture ;
- syntaxe JavaScript et Bash ;
- 107 tests source réussis, 0 échec, 1 ignoré ;
- génération CycloneDX 1.6 déterministe et validation structurelle du graphe de références.

## Non déclaré comme exécuté

- `npm ci`, suite worker complète et `npm audit` final du worker sous Node.js 24 après retrait du SDK Resource Graph ;
- build/typecheck du frontend DEMO ONLY ;
- PostgreSQL 16 et intégration RLS ;
- Terraform `fmt`, `init`, `validate` et plan ;
- smoke Azure, alertes, Managed Identity-only, rotation, restauration, charge, pentest, tenant réel et rollback.

Le cycle de modification de la source est fermé. Les éléments restants sont des gates de qualification de la source immuable R2.2, pas une autorisation de correction à la volée.

## R2.2

Le profil et le runner PostgreSQL 16 local sont corrigés et versionnés. La gate PostgreSQL reste à exécuter sur le poste de qualification ; elle ne doit pas être considérée comme réussie sur la seule base de cette livraison.
