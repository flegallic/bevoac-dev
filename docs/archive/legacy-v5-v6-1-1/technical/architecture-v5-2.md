# Architecture technique Bevoac V5.2

## Statut

Documentation technique interne. Objectif: piloter une demonstration et un pilote B2B cadre, sans presenter Bevoac comme enterprise-ready.

## Vue d'ensemble

```text
Client / portail / integration partenaire
  -> Azure API Management optionnel
  -> API Fastify /v1
  -> Authentification API key
  -> Derivation tenant Bevoac
  -> Validation du perimetre autorise
  -> PostgreSQL transaction: scan, idempotency, billing reservation, outbox
  -> Outbox publisher
  -> Azure Service Bus scan-jobs
  -> Worker Azure Container Apps
  -> Scanners web / Entra / Azure infrastructure
  -> PostgreSQL scan_results
  -> API JSON + rapport PDF
```

## Control plane API

Responsabilites:

- authentification API key;
- derivation `tenant_id`;
- rejet des tenants fournis par le client;
- validation cibles web/Azure;
- creation idempotente;
- reservation billing;
- ecriture outbox;
- publication Service Bus;
- exposition JSON/PDF;
- onboarding Azure;
- routes billing/admin.

## Data plane worker

Responsabilites:

- consommer Service Bus;
- valider le schema de message;
- marquer `IN_PROGRESS`;
- executer les modules;
- preflight resource count;
- stocker dans `scan_results`;
- finaliser `DONE` ou `FAILED`;
- transitionner billing vers `CONSUMED` ou `REFUNDED`.

## Ce que V5.2 prouve

- Decouplage API/worker.
- Creation scan fiable via outbox.
- Idempotence client et serveur.
- Multi-tenant applicatif.
- Billing lifecycle defendable.
- Retention planifiee.
- Alerting de base.
- APIM optionnel.

## Ce que V5.2 ne prouve pas encore

- Production enterprise complete.
- RLS PostgreSQL.
- Pentest valide.
- Restore backup teste.
- Load test multi-tenant large.
- DR/SLO contractuels.
- Modele Azure cross-tenant zero-secret.
