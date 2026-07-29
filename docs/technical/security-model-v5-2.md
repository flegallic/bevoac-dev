# Modele securite Bevoac V5.2

## Authentification client

- Clients: API key Bearer.
- Cle stockee hashee.
- Tenant derive de la cle.
- Cle inactive ou expiree refusee.

## Autorisation tenant

- `tenantId` et `customerId` refuses dans le body.
- Scans web autorises via `tenant_web_targets`.
- Scans Azure autorises via `tenant_azure_scopes`.
- Lectures de scans filtrees par `scan_id` et `tenant_id`.

## SSRF

Les scanners web appliquent:

- HTTPS par defaut;
- blocage localhost, `.local`, `.internal`;
- blocage IP privees, link-local, reservees, metadata cloud;
- resolution DNS obligatoire;
- revalidation apres redirection;
- nombre de redirections limite;
- connexion epinglee a IP validee;
- timeouts.

## Secrets

Secrets attendus en Key Vault:

- `PG_PASSWORD`;
- `MICROSOFT_CLIENT_SECRET`;
- `ONBOARDING_STATE_SECRET`;
- `ADMIN_API_SECRET` uniquement fallback controle;
- Service Bus connection string uniquement pour KEDA scale trigger si necessaire.

## Admin

En pilote securise et production:

- `ADMIN_AUTH_MODE=oidc`;
- issuer et audience verifies;
- role/scope/groupe requis;
- shared secret uniquement exception tracee.

## Donnees sensibles

Bevoac traite potentiellement:

- resource IDs Azure;
- noms de ressources;
- resultats de controles;
- informations Entra;
- evidence technique;
- donnees de billing;
- metadonnees client.

## Risques residuels

| Criticite | Sujet | Statut |
|---|---|---|
| Elevee | Secret Microsoft cross-tenant | Modele courant, a durcir a terme |
| Elevee | Pentest API/SSRF/auth/PDF | Non confirme dans le depot analyse |
| Moyenne | RLS PostgreSQL | Non confirme dans le depot analyse |
| Moyenne | Logs sensibles | A auditer avant production |
| Moyenne | Backup/restore | Non confirme dans le depot analyse |
