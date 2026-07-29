# Modele de donnees Bevoac V5.1

## 1. Objectif

Documenter le modele de donnees courant de Bevoac V5.1 et supprimer l'ambiguite historique `scans.result`.

## 2. Tables principales

| Table | Role |
|---|---|
| `tenants` | Tenants Bevoac, plan, activation |
| `api_keys` | Cles API hashees, rattachees a un tenant |
| `tenant_web_targets` | Hosts web autorises par tenant |
| `tenant_azure_integrations` | Etat d'integration Microsoft par tenant Bevoac |
| `tenant_azure_scopes` | Microsoft tenant/subscriptions autorises |
| `azure_onboarding_sessions` | Sessions Microsoft admin consent courtes et anti-replay |
| `scans` | Statut, metadonnees, cible, billing, timestamps |
| `scan_results` | Resultat complet, compression, hash, resume, taille |
| `scan_attempts` | Tentatives worker, idempotence de traitement |
| `scan_request_idempotency` | Deduplication de creation de scan |
| `billing_usage_ledger` | Ledger billing append-oriented |
| `billing_monthly_snapshots` | Snapshots mensuels |
| `admin_audit_log` | Actions admin critiques |
| `retention_audit_log` | Journalisation des suppressions de retention |

## 3. Regle V5.1 sur les resultats

Regle a appliquer dans toute documentation active:

```text
Le resultat complet du scan est stocke dans scan_results.
```

La table `scan_results` contient:

- `scan_id`;
- `tenant_id`;
- `result_json`;
- `result_gzip_base64`;
- `compression`;
- `result_size_bytes`;
- `result_sha256`;
- `result_summary`;
- timestamps.

`scans.result` ne doit plus etre presente comme modele courant. Si elle apparait dans le code, elle doit etre decrite comme legacy/fallback de migration.

## 4. Resume de resultat

`result_summary` doit permettre les vues rapides sans charger le JSON complet:

- nombre de findings;
- repartition par severite;
- presence web / Entra / Azure infra;
- eventuelle erreur;
- preflight ressources.

## 5. Donnees sensibles

Les resultats peuvent contenir:

- noms de ressources Azure;
- resource IDs;
- subscriptions;
- tenant Microsoft;
- UPN / utilisateurs selon modules Entra;
- signaux de securite;
- evidence de configuration.

Implications:

- retention stricte;
- acces API filtre par `tenant_id`;
- redaction possible dans un futur profil PDF executif;
- logs sans secrets;
- chiffrement au repos via plateforme Azure/PostgreSQL a confirmer par configuration runtime.

## 6. Retention

Le script `retention-sweep.js` existe cote API. Il doit etre documente comme disponible, pas comme automatiquement deployee tant que l'IaC n'inclut pas un scheduler verifie.

## 7. Backlog donnees

| Priorite | Sujet | Raison |
|---|---|---|
| P0 | idempotency key serveur | coherence API/doc |
| P0 | transactional outbox | eviter scans PENDING sans message |
| P1 | RLS ou tests d'isolation DB | renforcer multi-tenant |
| P1 | migrations versionnees | remplacer scripts init non versionnes |
| P1 | job retention planifie | conformite pilote/prod |
