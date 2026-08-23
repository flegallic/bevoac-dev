# Bevoac V6.2.0 — Contenu du package source consolidé

## Inclus

- API entreprise complète ;
- worker entreprise complet ;
- frontend explicitement DEMO ONLY ;
- Terraform/IaC complet ;
- migrations PostgreSQL ;
- CI GitHub Actions ;
- contrats API/worker ;
- tests ;
- scripts de validation, collecte de preuves et release contrôlée ;
- documentation active V6.2.0 ;
- historique documentaire conservé ;
- matrice de fermeture des constats ;
- baseline cryptographique ;
- manifeste SHA-256 des fichiers source ;
- preuve de validation source R2 ;
- gate de résolution des imports relatifs ;
- runner PostgreSQL 16 local R2.2 avec collecte de preuves ;
- test de régression du profil PostgreSQL local.

## Exclus

- `.git` et historique Git local ;
- `node_modules` ;
- `.terraform` ;
- states et plans Terraform ;
- `.env` réels ;
- secrets ;
- caches, builds, couvertures et logs locaux ;
- preuves contenant des valeurs sensibles ;
- les trois scripts locaux non suivis de la machine de l’opérateur.

## Règle d’utilisation

Ce ZIP remplace les packages PR-00A isolés. Il doit être extrait à côté du dépôt actif pour vérification, puis intégré par branche/revue. Il ne doit pas être copié à l’aveugle sur `main` ni déployé sans exécution des gates.
