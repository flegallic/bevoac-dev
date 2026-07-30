# Modèle de sécurité V6.1.2

## Principes

- moindre privilège ;
- séparation des runtimes ;
- tenant dérivé côté serveur ;
- RLS basée sur `session_user` ;
- allowlists web/Azure ;
- SSRF guard ;
- secrets Key Vault ;
- Managed Identity ;
- APIM et OIDC admin ;
- preuves reproductibles.

## Frontières

1. API key et scopes ;
2. logique métier tenant-scoped ;
3. login PostgreSQL dédié ;
4. grants explicites ;
5. RLS forcée ;
6. identités Azure/RBAC ;
7. réseau ;
8. observabilité et incident response.

`app.service_context` est interdit dans le runtime actif.
