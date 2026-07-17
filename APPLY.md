# Procedure d'application

## 1. Pre-requis

- Depot Bevoac en branche de travail dediee, jamais directement sur `main`.
- Node.js >= 20.
- PostgreSQL de test accessible.
- Variables `.env` API et worker disponibles.
- Terraform installe pour les controles IaC.

## 2. Sauvegarde

Le script d'application cree une sauvegarde horodatee sous :

```text
.bevoac-enterprise-hardening-backup/<timestamp>/
```

Les fichiers existants ecrases y sont copies avant modification.

## 3. Application

```bash
python scripts/apply_enterprise_hardening.py --repo-root /path/to/bevoac --package-root /path/to/package
```

Options utiles :

```bash
--dry-run       Affiche les operations sans modifier le depot
--force         Reapplique meme si certains marqueurs existent deja
```

## 4. Validation obligatoire

Voir `VALIDATION_MATRIX.md`.

## 5. Politique de merge

Le merge vers `main` est interdit tant que :

- `npm run check` API et worker est OK ;
- `npm test` API et worker est OK ;
- `npm run migrate-db` fonctionne sur DB vide ;
- `npm run check:enterprise-hardening` est OK ;
- `npm run check:tenant-isolation:enterprise` est OK si RLS stricte activee ;
- Terraform validate est OK ;
- la generation PDF a ete testee sur un scan DONE ;
- une revue humaine du runbook a confirme qu'aucune information operationnelle historique n'a ete supprimee.
