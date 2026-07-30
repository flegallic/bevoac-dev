# Architecture technique V6.1.2

## Runtimes

- APIM : gateway B2B ;
- public API : HTTP tenant-scoped ;
- admin API : HTTP OIDC global borné ;
- outbox : daemon sans ingress ;
- worker : consumer Service Bus sans ingress ;
- retention : job planifié ;
- PostgreSQL : source de vérité et RLS ;
- Key Vault : secrets par workload ;
- ACR : images immuables ;
- Monitor/Log Analytics : observabilité.

## Flux scan

API → transaction PostgreSQL → outbox → Service Bus → worker → résultats/billing → JSON/PDF.

## Sécurité

Identité applicative, identité managée Azure et login PostgreSQL sont séparés. Aucun composant ne doit disposer de plus de droits que son flux.
