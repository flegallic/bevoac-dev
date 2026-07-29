# Addendum V5.1 - idempotence, backpressure et contrat worker

La V5.1 conserve les invariants V2/V3/V4 et ajoute :

- `Idempotency-Key` optionnelle avec génération serveur si absente ;
- réponse API enrichie avec les informations d'idempotence quand disponible ;
- backpressure par tenant et par plan ;
- Service Bus sessions avec `sessionId=tenantId` ;
- contrat API/worker centralisé pour éviter les divergences de version ;
- procédures DLQ de purge/replay ;
- rapport PDF Azure infra validé comme sortie finding/remediation/evidence.

Les intégrateurs B2B critiques restent encouragés à fournir une `Idempotency-Key` stable par tentative métier afin d'éviter les doublons en cas de retry réseau perdu.
