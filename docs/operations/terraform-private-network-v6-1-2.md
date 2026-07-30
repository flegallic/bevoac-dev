# Réseau privé Terraform V6.1.2

## Etat observé

Le dernier alignement transmis conserve :

```text
enable_private_endpoints=false
enable_postgres_public_access=true
enable_db_admin_public_ip_rule=true
```

Il s'agit d'une transition, pas de la cible enterprise stricte.

## Cible

- Private Endpoint PostgreSQL ;
- Private Endpoint Key Vault ;
- Private DNS zones liées au VNet ;
- runner privé/VPN pour Terraform et opérations ;
- suppression des règles firewall publiques ;
- résolution DNS et connectivité testées depuis ACA et l'administration.

## Gate

Ne pas passer `public_network_access=false` avant preuve de résolution DNS et de connectivité des workloads. Ne pas maintenir ensuite une ouverture publique de confort.
