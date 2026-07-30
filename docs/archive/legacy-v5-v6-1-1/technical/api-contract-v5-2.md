# Contrat API et messages Bevoac V5.2

## Objectif

Documenter le contrat actif Bevoac V5.2 pilot hardening pour les tests client et admin.

## Endpoints client

| Endpoint | Role | Auth |
|---|---|---|
| `GET /v1/health` | Sante API | Public ou APIM selon deploiement |
| `POST /v1/scans` | Creer un scan | API key Bevoac |
| `GET /v1/scans` | Lister les scans du tenant | API key Bevoac |
| `GET /v1/scans/:scanId` | Lire statut/resultat | API key Bevoac |
| `GET /v1/scans/:scanId/pdf` | Generer le PDF | API key Bevoac |
| `GET /v1/billing/overview` | Vue billing tenant | API key Bevoac |
| `GET /v1/billing/current-month/scans` | Detail mensuel | API key Bevoac |
| `POST /v1/onboarding/azure/start` | Demarrer admin consent | API key Bevoac |
| `GET /v1/onboarding/azure/callback` | Callback Microsoft | Public protege par state HMAC |
| `GET /v1/onboarding/azure/status` | Etat onboarding | API key Bevoac |
| `POST /v1/onboarding/azure/verify` | Verification RBAC/scopes | API key Bevoac |

## Regles d'identite tenant

- Le tenant Bevoac est derive de l'API key.
- `tenantId` et `customerId` fournis par le caller sont rejetes.
- Les lectures de scans filtrent toujours par `scan_id` et `tenant_id`.
- Les scans web utilisent `tenant_web_targets`.
- Les scans Azure utilisent `tenant_azure_scopes` avec `status=VERIFIED` pour les subscriptions.

## Creation de scan web

```json
{
  "cloudProvider": "azure",
  "scanProfile": "web",
  "modules": ["web"],
  "azure": {
    "targetUrl": "https://example.com"
  }
}
```

## Creation de scan infra Azure

```json
{
  "cloudProvider": "azure",
  "scanProfile": "infra",
  "modules": ["storage"],
  "azure": {
    "microsoftTenantId": "<microsoft-tenant-id>",
    "subscriptionIds": ["<subscription-id>"]
  }
}
```

## Idempotence V5.2

L'idempotence serveur est livree.

- Si le client fournit `Idempotency-Key`, Bevoac l'utilise.
- Si le client ne fournit pas `Idempotency-Key`, Bevoac genere une UUID serveur.
- La reponse expose `idempotencyKey`, `idempotencyKeySource` et `idempotentReplay`.
- Le replay retourne le meme `scanId`.

## Transactional outbox

La creation d'un scan ecrit dans la meme transaction:

- `scans`;
- `billing_usage_ledger` avec `scan_reserved`;
- `scan_request_idempotency`;
- `outbox_events` avec `scan.requested`.

L'envoi Service Bus est effectue par publisher asynchrone avec retry.

## Contrat API/worker

Source active:

```text
bevoac-api-enterprise/contracts/scan-message-version.json
bevoac-api-enterprise/contracts/scan-request.schema.json
bevoac-worker-enterprise/contracts/scan-message-version.json
bevoac-worker-enterprise/contracts/scan-request.schema.json
```

Version active:

```text
2026-05-06-production-hardening-v5
```

Controle:

```bash
cd bevoac-api-enterprise
npm run check
```

## Billing V5.2

| Evenement | Moment | Effet |
|---|---|---|
| `scan_reserved` | Creation du scan | Reserve quota/facturation |
| `scan_consumed` | Worker termine en `DONE` | Consomme definitivement |
| `scan_refunded` | Worker termine en `FAILED` controle | Rembourse/neutralise le scan |

Etats scan:

| Scan status | billing_state attendu |
|---|---|
| `PENDING` | `RESERVED` |
| `IN_PROGRESS` | `RESERVED` |
| `DONE` | `CONSUMED` |
| `FAILED` | `REFUNDED` |

## Reponses API

La reponse de listing expose `billingState` au niveau racine. La reponse detail doit aussi exposer `billingState` au niveau racine et dans `billing.billingState`.

## PDF

`GET /v1/scans/:scanId/pdf` est disponible uniquement pour un scan `DONE` ou `FAILED` avec resultat. Le PDF est un rapport finding/remediation/evidence. Le JSON reste la source exhaustive.
