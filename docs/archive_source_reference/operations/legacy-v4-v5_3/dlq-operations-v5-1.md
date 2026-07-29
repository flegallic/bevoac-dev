# Exploitation DLQ Service Bus Bevoac V5.1

## 1. Objectif

Documenter l'inspection, le replay et la purge controlee de la DLQ `scan-jobs`.

## 2. Etat nominal

```bash
az servicebus queue show   --resource-group <rg>   --namespace-name <namespace-short>   --name scan-jobs   --query "{requiresSession:requiresSession,active:countDetails.activeMessageCount,deadLetter:countDetails.deadLetterMessageCount,transferDeadLetter:countDetails.transferDeadLetterMessageCount}"   -o json
```

Attendu:

```json
{
  "requiresSession": true,
  "active": 0,
  "deadLetter": 0,
  "transferDeadLetter": 0
}
```

## 3. Causes frequentes

| Cause | Symptome | Action |
|---|---|---|
| Contrat API/worker desynchronise | erreur `/version` | redeployer API/worker alignes, purger/rejouer |
| Worker sans role receiver | Listen claim required | attribuer Data Receiver |
| Session mismatch | worker ne consomme pas | aligner `requiresSession` et `SERVICEBUS_SESSIONS_ENABLED` |
| Erreur module | stack scanner | corriger module puis replay controle |
| Message obsolete POC | DLQ non recuperable | purge controlee ou recreation queue en POC uniquement |

## 4. Stats DLQ

```bash
cd bevoac-worker-enterprise
node scripts/dlq-stats.js
```

## 5. Replay controle

Dry-run:

```bash
DRY_RUN=true MAX_REPLAY=10 node scripts/dlq-replay.js
```

Replay reel:

```bash
DRY_RUN=false MAX_REPLAY=10 node scripts/dlq-replay.js
```

## 6. Purge

La purge doit etre documentee:

- date/heure;
- operateur;
- queue;
- sessionId;
- messageId/sequenceNumber;
- cause;
- decision;
- resultat.

En production, ne jamais purger sans justification.
