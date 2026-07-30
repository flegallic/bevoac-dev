# Publisher outbox dédié V6.1.2

## Garantie transactionnelle

L'API publique écrit le scan, le billing, l'idempotence et l'événement `outbox_events` dans une seule transaction PostgreSQL. Désactiver le publisher embarqué ne désactive pas cet INSERT.

## Séparation des responsabilités

- `public_api` : aucune publication Service Bus directe ;
- `outbox` : lecture/update globale de `outbox_events`, droit Sender ;
- `worker` : droit Receiver, traitement et persistance du résultat.

## Variables API publique

```text
OUTBOX_PUBLISHER_ENABLED=false
OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST=false
```

## Risque si le runtime outbox manque

Le risque principal est la disponibilité : événements durables mais `PENDING`, worker non déclenché et scans en attente. Ce n'est pas une fuite intertenant.

## Monitoring

- nombre et âge des `PENDING` ;
- `FAILED`, attempts et last_error ;
- Service Bus active messages ;
- DLQ ;
- scans PENDING anciens.
