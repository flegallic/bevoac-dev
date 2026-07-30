# Worker Bevoac V5.1

## 1. Role

Le worker execute les scans de maniere asynchrone. Il consomme les messages `scan.requested` depuis Azure Service Bus, execute les modules et persiste les resultats dans `scan_results`.

## 2. Comportement nominal

1. reception message Service Bus;
2. validation schema;
3. creation `scan_attempts`;
4. passage `PENDING` -> `IN_PROGRESS`;
5. preflight resource count pour modules infra;
6. execution modules demandes;
7. stockage resultat complet;
8. passage en `DONE` ou `FAILED`;
9. completion du message Service Bus.

## 3. Idempotence worker

Le worker ne doit traiter qu'un scan en statut `PENDING`. Si le scan est deja traite ou non eligible, la tentative est marquee `SKIPPED` et le message peut etre complete.

## 4. Service Bus sessions

Quand activees:

- `sessionId = tenantId`;
- les messages d'un meme tenant sont traites sequentiellement;
- plusieurs tenants peuvent progresser en parallele;
- cela limite la monopolisation de la plateforme par un tenant.

## 5. Timeouts

Timeouts attendus:

- global scan;
- headers web;
- DNS;
- TLS;
- nmap;
- Entra;
- Azure infra;
- resource preflight.

Limite actuelle a documenter:

- les timeouts par `Promise.race` ne garantissent pas toujours l'annulation de l'operation sous-jacente;
- il faut ajouter AbortController/retry/backoff lorsque les SDK le permettent.

## 6. Retours d'erreur

- message invalide: DLQ;
- erreur scanner persistable: scan `FAILED`, message complete;
- erreur DB lors de la persistance: abandon du message pour retry Service Bus.

## 7. Backlog worker avant pilote robuste

| Priorite | Sujet | Objectif |
|---|---|---|
| P1 | retry/backoff Azure et Graph | reduire faux `FAILED` sur throttling |
| P1 | logger structure par module | meilleure observabilite |
| P1 | tests modules avec mocks Azure | limiter regressions |
| P2 | registry de modules | refactor orchestrateur infra |
| P2 | redaction de donnees sensibles | logs et evidence |
