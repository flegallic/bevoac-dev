# Bevoac V5.1 - Exploitation DLQ Service Bus

## Objectif

Ce document décrit la gestion de la DLQ `scan-jobs` pour Bevoac V5.1.

## 1. Vérifier la queue

```bash
az servicebus queue show \
  --resource-group <rg> \
  --namespace-name <service-bus-namespace-short> \
  --name scan-jobs \
  --query "{requiresSession:requiresSession,active:countDetails.activeMessageCount,deadLetter:countDetails.deadLetterMessageCount,transferDeadLetter:countDetails.transferDeadLetterMessageCount}" \
  -o json
```

État nominal :

```json
{
  "requiresSession": true,
  "active": 0,
  "deadLetter": 0,
  "transferDeadLetter": 0
}
```

## 2. Causes fréquentes

| Cause | Symptôme | Action |
|---|---|---|
| Contrat API/worker désaligné | `/version must be equal to constant` | Déployer API/worker avec même contrat puis purger/rejouer |
| Worker sans rôle receiver | `Listen claim required` | Attribuer `Azure Service Bus Data Receiver` |
| Queue sessions mismatch | worker ne consomme pas | Aligner `requiresSession` et `SERVICEBUS_SESSIONS_ENABLED` |
| Erreur scanner | message DLQ avec stack module | Corriger module puis replay contrôlé |
| Message obsolète POC | DLQ 1, active 0 | Purge contrôlée |

## 3. Stats DLQ

```bash
cd bevoac-worker-enterprise
node scripts/dlq-stats.js
```

## 4. Replay contrôlé

Dry-run :

```bash
DRY_RUN=true MAX_REPLAY=10 node scripts/dlq-replay.js
```

Réel :

```bash
DRY_RUN=false MAX_REPLAY=10 node scripts/dlq-replay.js
```

## 5. Purge d'un message obsolète

Utiliser le script `purge-dlq.js` lorsque le message est connu comme obsolète et ne doit pas être rejoué.

Dry-run :

```bash
node scripts/purge-dlq.js \
  --fq-namespace=sb-bevoac-prod.servicebus.windows.net \
  --queue=scan-jobs \
  --sessions=true \
  --credential=cli \
  --max-wait-ms=30000
```

Purge :

```bash
node scripts/purge-dlq.js \
  --fq-namespace=sb-bevoac-prod.servicebus.windows.net \
  --queue=scan-jobs \
  --sessions=true \
  --credential=cli \
  --max-wait-ms=30000 \
  --yes
```

## 6. Cas session DLQ non récupérable par SDK

Si Azure indique `deadLetter=1` mais que le SDK ne trouve aucune session DLQ :

1. vérifier `transferDeadLetterMessageCount` ;
2. utiliser Azure Portal > Service Bus Explorer > Dead-letter > Delete/Complete ;
3. en POC uniquement, recréer la queue si aucun message actif ou planifié n'existe.

Remplacement POC :

```bash
terraform state list | grep servicebus_queue
terraform plan -replace='azurerm_servicebus_queue.scan_jobs' -out=tfplan.replace-queue
terraform apply tfplan.replace-queue
rm -f tfplan.replace-queue
```

## 7. Règle de traçabilité

Toute purge ou replay doit documenter date/heure, opérateur, queue, sessionId, messageId/sequenceNumber, cause, décision et résultat.
