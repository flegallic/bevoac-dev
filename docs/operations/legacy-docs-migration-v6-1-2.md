# Migration du corpus V5/V6.1.1 vers V6.1.2-R3

## Principe

Les anciens documents ne sont pas supprimés. Ils sont déplacés sous `docs/archive/legacy-v5-v6-1-1/` avec conservation du nom d'origine.

## Doublons consolidés

- architectures tiret/underscore ;
- cycles de scan tiret/underscore ;
- isolation tenant tiret/underscore ;
- APIM V5.3 et APIM mandatory V6.1.1 ;
- outbox V5.3 et publisher V5.3 ;
- deux runbooks V6.1.2 concurrents.

## Commandes historiques interdites

Les références actives à `check:tenant-isolation:enterprise`, `migrate-db:enterprise-rls` comme chemin applicable, ou `app.service_context` doivent disparaître des documents actifs.
