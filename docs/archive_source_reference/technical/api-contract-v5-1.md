# Contrat API et messages Bevoac V5.1

## 1. Objectif

Documenter le contrat API/worker actif V5.1 et les ecarts a corriger avant un pilote B2B.

## 2. Endpoints client principaux

| Endpoint | Role | Authentification |
|---|---|---|
| `GET /v1/health` | Sante API | publique ou selon deploiement |
| `POST /v1/scans` | Creer un scan | API key |
| `GET /v1/scans` | Lister les scans du tenant | API key |
| `GET /v1/scans/:scanId` | Lire statut et resultat | API key |
| `GET /v1/scans/:scanId/pdf` | Generer le rapport PDF | API key |
| `GET /v1/billing/overview` | Vue billing tenant | API key |
| `GET /v1/billing/current-month/scans` | Detail mensuel | API key |
| `POST /v1/onboarding/azure/start` | Demarrer admin consent Microsoft | API key |
| `GET /v1/onboarding/azure/callback` | Callback Microsoft | public protege par state HMAC |
| `GET /v1/onboarding/azure/status` | Etat onboarding Azure | API key |
| `POST /v1/onboarding/azure/verify` | Reverification RBAC/scopes | API key |

## 3. Endpoints admin

| Endpoint | Role | Authentification |
|---|---|---|
| `GET /v1/admin/billing/overview` | Vue billing globale | OIDC admin en production |
| `GET /v1/admin/billing/tenants/:tenantId/ledger` | Ledger tenant | OIDC admin en production |
| `POST /v1/admin/billing/close-month` | Cloture mensuelle | OIDC admin en production |

Le shared secret admin ne doit rester qu'un fallback local/staging ou break-glass explicitement trace.

## 4. Creation de scan

Exemple infra Azure:

```json
{
  "cloudProvider": "azure",
  "scanProfile": "infra",
  "azure": {}
}
```

Exemple web:

```json
{
  "cloudProvider": "azure",
  "scanProfile": "web",
  "azure": {
    "targetUrl": "https://example.com"
  }
}
```

Regles:

- `cloudProvider` accepte uniquement `azure` en V5.1.
- `scanProfile` accepte `web`, `entra`, `infra`, `full`.
- `tenantId` et `customerId` fournis par le caller doivent etre rejetes.
- Le tenant Bevoac est derive de la cle API.
- Les cibles web doivent etre enregistrees dans `tenant_web_targets`.
- Les cibles Azure doivent etre verifiees dans `tenant_azure_scopes`.

## 5. Idempotence

Comportement produit V5.1 attendu:

- si le client fournit `Idempotency-Key`, l'API reutilise cette cle pour eviter les doublons;
- si le client ne fournit pas `Idempotency-Key`, l'API doit generer une cle serveur, la stocker et la retourner;
- la reponse doit indiquer `idempotencyKey`, `idempotencyKeySource` et `idempotentReplay`.

Statut actuel:

- comportement server-generated a conserver dans la documentation comme exigence produit;
- implementation API a corriger en P0 si elle ne genere pas encore la cle serveur.

Ticket P0:

```text
Implementer l'idempotency key serveur dans POST /v1/scans.
Fichiers concernes:
- bevoac-api-enterprise/src/routes/scans.js
- bevoac-api-enterprise/src/services/scan-service.js
Criteres d'acceptation:
- header absent -> UUID genere;
- insertion dans scan_request_idempotency;
- reponse expose idempotencyKeySource=server_generated;
- replay renvoie le meme scan.
```

## 6. Contrat message API/worker

Source de verite:

```text
contracts/scan-message-version.json
```

Version V5.1:

```text
2026-05-06-production-hardening-v5
```

Le schema API et le schema worker doivent utiliser la meme version. Toute occurrence active de `2026-04-28` doit etre supprimee ou archivee.

Controle:

```bash
grep -R "2026-04-28" -n .
grep -R "2026-05-06-production-hardening-v5" -n contracts bevoac-api-enterprise/contracts bevoac-worker-enterprise/contracts
```

Backlog P1:

- etendre `scripts/sync-contracts.js` pour synchroniser aussi `bevoac-api-enterprise/contracts/scan-request.schema.json`;
- ajouter une verification CI bloquante si les contrats divergent.

## 7. Statuts de scan

| Statut | Signification |
|---|---|
| `PENDING` | Scan cree, en attente de traitement |
| `IN_PROGRESS` | Worker en cours |
| `DONE` | Scan termine sans erreur bloquante globale |
| `FAILED` | Echec worker, limite de ressources ou erreur bloquante |

## 8. Reponse PDF

`GET /v1/scans/:scanId/pdf` doit etre disponible seulement lorsque le scan est `DONE` ou `FAILED` et qu'un resultat existe.

Le PDF est borne par:

- taille max JSON entree;
- timeout generation PDF;
- nombre max de findings;
- nombre max d'evidence items.

## 9. Risques API a suivre

| Priorite | Risque | Correction |
|---|---|---|
| P0 | scan cree mais message Service Bus non publie | transactional outbox |
| P0 | idempotence serveur non livree | generation serveur |
| P1 | schema API/worker divergent | contrat unique et CI |
| P1 | billing comptabilise avant scan termine | etat reserved/consumed/refunded |
