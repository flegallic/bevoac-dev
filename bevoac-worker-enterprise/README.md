# bevoac-worker-enterprise v4

Worker asynchrone Bevoac pour scans web, Microsoft Entra et Azure infrastructure. Il consomme les messages `scan.requested` depuis Azure Service Bus, met à jour PostgreSQL et stocke les résultats JSON.

## Responsabilités

- Valider le contrat `contracts/scan-request.schema.json`.
- Marquer le scan `IN_PROGRESS`.
- Créer un credential cross-tenant via `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`.
- Exécuter un preflight Azure Resource Graph pour compter les ressources infra.
- Bloquer le scan si la limite de ressources du plan est dépassée.
- Lancer les modules demandés.
- Marquer le scan `DONE` ou `FAILED`.

## Modules

- Web : DNS SPF, TLS, headers, nmap.
- Entra : Conditional Access, MFA, legacy auth, rôles privilégiés, guests, utilisateurs inactifs, risky sign-ins.
- Azure infra : `storage`, `vms`, `nsg`, `keyvault`, `logs`, `db`, `governance`, `appservices`, `finops`, `entra_b2b`, `tags`.

## Variables critiques

```env
NODE_ENV=production
SERVICEBUS_AUTH_MODE=managed_identity
SERVICEBUS_FQ_NAMESPACE=<namespace>.servicebus.windows.net
SERVICEBUS_QUEUE_NAME=scan-jobs
PG_SSL_MODE=verify-full
MICROSOFT_CLIENT_ID=<app registration client id>
MICROSOFT_CLIENT_SECRET=<secret>
DEFAULT_PLAN_STANDARD_RESOURCE_LIMIT=500
DEFAULT_PLAN_BUSINESS_RESOURCE_LIMIT=2500
```

## Commandes

```bash
npm ci
npm run check
npm start
```

En production Azure Container Apps, le worker doit utiliser Managed Identity pour Service Bus et Key Vault. Le client secret Microsoft est utilisé pour accéder au tenant client après admin consent et RBAC.
