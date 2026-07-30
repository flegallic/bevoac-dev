# Architecture Bevoac V6.1.2 Enterprise Hardened

## Objectif

Stabiliser Bevoac comme API SaaS B2B Azure-first fortement durcie, sans pretendre que le module AWS est deja operationnel.

## Composants

| Composant | Role | Durcissement apporte |
|---|---|---|
| APIM | Frontdoor API | Subscription key, quota, rate limit, content validation, correlation ID |
| API Fastify | Control plane | API key scopes, tenant context DB, result endpoint explicite |
| PostgreSQL | Source de verite | Baseline corrigee, RLS enterprise optionnelle, result store tenant-aware |
| Outbox | Fiabilite publication | Service context dedie, retries/backoff |
| Service Bus | Orchestration async | Sessions par tenant si activees, DLQ |
| Worker | Execution scans | Tenant context DB, summary findings centralise |
| Key Vault | Secrets | Managed identity, pas de secret en clair dans IaC |
| Container Apps | Runtime | API/worker/outbox separes |

## Decisions d'architecture

1. Le tenant n'est jamais fourni par le client ; il vient de l'API key.
2. Les resultats complets ne sont plus exposes par defaut.
3. La RLS s'appuie sur un contexte DB explicite.
4. AWS est scaffolded mais non runtime-enabled tant que les scanners ne sont pas termines.
5. Les findings sont collectes par une logique centralisee pour eviter les divergences PDF/API/worker.

## Contrat multi-cloud cible

Le futur contrat V7 doit remplacer les champs Azure-only par :

```json
{
  "cloudProvider": "azure|aws",
  "targets": {
    "web": {},
    "azure": {},
    "aws": {}
  }
}
```

La V6.1.2 garde volontairement le contrat runtime Azure pour eviter une activation AWS prematuree.
