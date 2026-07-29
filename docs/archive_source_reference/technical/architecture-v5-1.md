# Architecture technique Bevoac V5.1 Azure-first

## 1. Statut

Documentation technique interne.  
Version: V5.1 Azure-first.  
Objectif: cadrer une demonstration et un pilote B2B, sans presenter la plateforme comme enterprise-ready.

## 2. Vue d'ensemble

Bevoac V5.1 repose sur une architecture decouplee:

```text
Client / portail / integration partenaire
  -> API Fastify /v1
  -> Authentification par API key
  -> Derivation tenant Bevoac
  -> Validation du perimetre autorise
  -> PostgreSQL: scans, billing, scopes, resultats
  -> Azure Service Bus: scan-jobs
  -> Worker Azure Container Apps
  -> Scanners web / Entra / Azure infrastructure
  -> PostgreSQL scan_results
  -> API JSON + rapport PDF
```

## 3. Control plane API

Responsabilites:

- authentification API key;
- derivation `tenant_id` depuis la cle API;
- rejet de `tenantId` et `customerId` fournis par le client;
- creation de scans;
- validation des cibles web et Azure via allowlists;
- publication de messages `scan.requested`;
- exposition des resultats JSON;
- generation PDF;
- billing et quotas;
- onboarding Azure;
- routes admin billing.

## 4. Data plane worker

Responsabilites:

- consommer la queue Service Bus `scan-jobs`;
- valider le contrat message;
- marquer le scan `IN_PROGRESS`;
- executer les modules demandes;
- realiser un preflight resource count pour l'infra Azure;
- bloquer si la limite de ressources du plan est depassee;
- stocker le resultat complet dans `scan_results`;
- finaliser le scan en `DONE` ou `FAILED`.

## 5. Modules V5.1

| Domaine | Modules |
|---|---|
| Web | headers, TLS, DNS, nmap |
| Entra | conditional access, MFA, legacy auth, roles privilegies, guests, risky sign-ins selon droits Graph |
| Azure infra | storage, vms, nsg, keyvault, logs, db, governance, appservices, finops, entra_b2b, tags |

## 6. Persistance

Le modele courant est:

- `scans`: statut, tenant, profil, cible, billing, timestamps, resume technique;
- `scan_results`: resultat JSON complet, compression eventuelle, hash, taille, resume;
- `scan_attempts`: tentative worker et idempotence de traitement;
- `billing_usage_ledger`: evenements de billing;
- `tenant_azure_scopes`: allowlist Azure;
- `tenant_web_targets`: allowlist web;
- `azure_onboarding_sessions`: sessions Microsoft admin consent.

`scans.result` est considere legacy. Il ne doit plus etre documente comme source principale.

## 7. Ce que l'architecture prouve

- Decouplage API / worker.
- Multi-tenant logique applicatif.
- Scans asynchrones.
- Backpressure par tenant/plan.
- Service Bus sessions par tenant si activees.
- Resultats durables dans PostgreSQL.
- PDF a la demande depuis resultat stocke.

## 8. Ce que l'architecture ne prouve pas encore

- Production enterprise complete.
- Sandbox dedie par scan.
- Isolation physique par tenant.
- Zero-secret pour les audits Azure cross-tenant.
- RLS PostgreSQL.
- Restore backup teste.
- Pentest valide.
- Load test multi-tenant documente.

## 9. Decision documentaire

La formulation correcte est:

> Bevoac V5.1 est un socle Azure-first production-oriented, pret a soutenir une demonstration et un pilote B2B cadre, sous reserve des validations techniques listees dans la release checklist.

La formulation interdite est:

> Bevoac est enterprise-ready.
