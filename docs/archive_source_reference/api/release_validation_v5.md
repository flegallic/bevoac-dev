# Bevoac V5.1 - Validation de recette production

## Objectif

Ce document donne une checklist de validation après déploiement V5.1.

## 1. API

```bash
curl -i "$API_BASE_URL/v1/health"
```

Attendu : HTTP 200.

## 2. Idempotence

Sans header :

```bash
curl -s -X POST "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"cloudProvider":"azure","scanProfile":"web","azure":{"targetUrl":"https://portdesigns.com"}}' | jq .
```

Attendu : `idempotentReplay=false`, `scanId` présent, et `idempotencyKeySource=server_generated` si la réponse expose ce champ.

Avec header client :

```bash
curl -s -X POST "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: validation-web-001" \
  -d '{"cloudProvider":"azure","scanProfile":"web","azure":{"targetUrl":"https://portdesigns.com"}}' | jq .
```

Relancer la même commande doit retourner le même scan avec `idempotentReplay=true`.

## 3. Worker et Service Bus

```bash
az servicebus queue show \
  --resource-group "$RESOURCE_GROUP" \
  --namespace-name "$SERVICE_BUS_NAMESPACE_SHORT" \
  --name scan-jobs \
  --query "{requiresSession:requiresSession,active:countDetails.activeMessageCount,deadLetter:countDetails.deadLetterMessageCount}" \
  -o json
```

Attendu après traitement : `active=0`, `deadLetter=0`.

## 4. Scan web

Vérifier status `DONE`, `resultSummary.hasWeb=true`, headers sans `Invalid IP address: undefined`, et findings cohérents.

## 5. Scan infra

Payload recommandé :

```json
{
  "cloudProvider": "azure",
  "scanProfile": "infra",
  "azure": {}
}
```

Attendu : status `DONE`, contrôles Azure présents, resource count inférieur au plan limit, PDF générable.

## 6. PDF

```bash
curl -L "$API_BASE_URL/v1/scans/<scanId>/pdf" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -o report.pdf
```

Vérifier fichier non vide, executive summary, severity distribution, control matrix, evidence appendix, methodology et pagination correcte.

## 7. Backpressure

Créer jusqu'à la limite de scans actifs du plan et vérifier l'erreur `TENANT_ACTIVE_SCAN_LIMIT_REACHED`. Puis attendre/clôturer les scans et vérifier que le tenant peut relancer.

## 8. Sécurité opérationnelle

- API key de test révoquée si exposée.
- Admin OIDC fonctionnel.
- Shared secret admin désactivé.
- Key Vault public access fermé.
- PostgreSQL public access fermé.
- Terraform exécuté depuis réseau privé.
- DLQ à zéro.
- Logs API/worker sans stack critique.
