# Installation From Scratch — Architecture V6.1.2-R3, release V6.1.3

## Objectif

Reconstruire Bevoac sur un environnement neuf sans connaissance préalable, sans state ni secret provenant d’un autre environnement et avec des gates reproductibles.

## Préflight

- branche/commit identifiés et arbre Git propre;
- Node.js 24, Docker/buildx, Terraform compatible avec le lockfile, Azure CLI, `jq`, `psql`;
- tenant/subscription Azure explicitement sélectionnés;
- backend Terraform distant, RBAC et réseau administratif définis;
- aucun `.env`, state, plan ou secret suivi dans Git.

## Séquence

### 1. Valider la source

```bash
./validate_release.sh --full
```

### 2. Bootstrap Azure sans workload

Définir `deploy_container_apps=false`, appliquer le socle, puis conserver le plan et les outputs expurgés.

### 3. Construire les images immuables

```bash
scripts/release/deploy_v6_1_3.sh build
```

### 4. Initialiser PostgreSQL

Ordre obligatoire :

```text
init-db.js
migrate-db.js                       # 6 migrations standard
apply-secure-api-key-auth.js        # frontière auth
apply-runtime-role-rls.js           # RLS runtime-role
```

Créer/synchroniser les six logins avant de démarrer les workloads restreints, puis exécuter le vérificateur structurel.

### 5. Déployer les workloads

Le déploiement cible :

- `public_api` / `bevoac_api`;
- worker / `bevoac_worker`;
- `outbox` / `bevoac_outbox`;
- `retention` / `bevoac_retention`;
- `admin_api` / `bevoac_admin_api`;
- `bevoac_operator` pour le provisioning contrôlé.

Pour un environnement neuf, les variables de finalisation peuvent être utilisées dès que le runner privé et le DNS sont prêts. Pour un environnement existant, respecter impérativement les deux phases du script de release.

### 6. Recette

- health;
- clé invalide 401;
- clé tenant A 200;
- scan tenant B invisible/404;
- création scan + outbox durable;
- publication Service Bus + traitement worker;
- billing, JSON et PDF;
- DLQ 0 et backlog 0;
- admin OIDC;
- rétention;
- rollback.

### 7. Promotion

Révision API candidate à 0%, puis 5%, 25% et 100% avec observation et retour immédiat à la révision stable si un gate échoue.

## NO-GO

- un workload utilise `bevoacadmin`;
- une migration/RLS/grant ne correspond pas à la matrice;
- API publique configurée avec Service Bus en mode outbox dédié;
- accès intertenant;
- plan destructif non approuvé;
- DLQ/backlog persistants;
- private endpoints activés sans chemin d’administration privé;
- Service Bus local auth supprimé avant preuve MI worker/outbox/scaler.
