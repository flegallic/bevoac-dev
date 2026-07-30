# Charge multi-tenant V6.1.2

## Objectif

Valider simultanément capacité, backpressure et isolation. Le test ne doit pas seulement mesurer le débit : il doit prouver l'absence de lecture croisée et l'absence de dérive DLQ/outbox.

## Scénario

- deux tenants au minimum ;
- clés API et cibles distinctes ;
- création concurrente de scans ;
- lectures de statut et tentatives croisées ;
- observation PostgreSQL, outbox, Service Bus et worker ;
- rattrapage complet après la charge.

## Critères

- 5xx inattendus sous le seuil approuvé ;
- 429 admis uniquement comme backpressure prévue ;
- zéro lecture croisée ;
- DLQ 0 après rattrapage ;
- aucun vieux `PENDING` ;
- billing cohérent ;
- latence et capacité documentées par plan.
