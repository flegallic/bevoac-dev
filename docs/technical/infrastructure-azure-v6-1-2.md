# Infrastructure Azure V6.1.2

## Services

Resource Group, VNet, subnets, NAT, ACR, Container Apps Environment, API, worker, outbox, retention job, PostgreSQL Flexible Server, Key Vault, Service Bus, APIM, Storage Static Website, Log Analytics et alertes.

## Identités

User Assigned Managed Identities distinctes pour API, worker, outbox, retention et admin API. L'opérateur PostgreSQL est un rôle DB, pas un runtime Internet.

## Etat réseau

La cible est privée. Le dernier état observé reste public avec firewall borné. Le passage au privé doit être précédé d'un préflight DNS/connectivité.
