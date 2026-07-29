# Modele securite Bevoac V5.1

## 1. Objectif

Documenter les controles de securite implementes ou attendus pour un pilote B2B cadre.

## 2. Authentification client

- Les clients utilisent une API key Bearer.
- La cle est hashee en base.
- Le tenant Bevoac est derive de la cle API.
- Les cles inactives ou expirees sont refusees.

## 3. Autorisation tenant

Regles obligatoires:

- `tenantId` et `customerId` ne doivent pas etre acceptes depuis le body client;
- les scans web doivent viser un host inscrit dans `tenant_web_targets`;
- les scans Azure doivent viser un Microsoft tenant/subscription inscrit dans `tenant_azure_scopes`;
- les lectures de scans doivent filtrer par `scan_id` et `tenant_id`.

## 4. Onboarding Azure

Le flux attendu:

1. le client demarre l'onboarding avec son API key;
2. l'API cree une session courte;
3. le state Microsoft est signe HMAC;
4. le state est hashe en base;
5. Microsoft appelle le callback API;
6. l'API verifie state, session, expiration, anti-replay et api_key_id;
7. Bevoac verifie les subscriptions visibles via Azure Management;
8. seules les subscriptions verifiees sont ajoutees dans l'allowlist.

## 5. SSRF et scans web

Les scanners web doivent appliquer:

- HTTPS par defaut;
- blocage localhost, `.local`, `.internal`;
- resolution DNS obligatoire;
- blocage IP privees, link-local, reservees, multicast, metadata cloud;
- revalidation apres redirection;
- nombre de redirections limite;
- connexion epinglee a une IP publique validee;
- timeouts par sous-module.

## 6. Secrets

Secrets attendus en Key Vault ou equivalent:

- `PG_PASSWORD`;
- `MICROSOFT_CLIENT_SECRET`;
- `ONBOARDING_STATE_SECRET`;
- `ADMIN_API_SECRET` uniquement fallback local/staging ou break-glass;
- connection string Service Bus uniquement pour le scale trigger KEDA si necessaire.

## 7. Admin

Production et pilote securise:

- `ADMIN_AUTH_MODE=oidc`;
- issuer et audience verifies;
- role/scope/groupe requis;
- shared secret interdit sauf exception tracee.

## 8. Donnees sensibles

Bevoac peut traiter:

- configurations Azure;
- resource IDs;
- noms de ressources;
- informations Entra;
- evidence de securite;
- donnees de billing;
- metadonnees client.

Les documents doivent eviter de promettre une conformite RGPD complete tant que retention, suppression, backup/restore et audit trail ne sont pas valides en environnement.

## 9. Risques residuels V5.1

| Criticite | Sujet | Statut |
|---|---|---|
| Elevee | Secret Microsoft cross-tenant | Modele actuel, a durcir a terme |
| Elevee | Tests multi-tenant automatises | Non confirme dans le depot analyse |
| Elevee | Pentest API/SSRF/auth/PDF | Non confirme dans le depot analyse |
| Moyenne | RLS PostgreSQL | Non confirme dans le depot analyse |
| Moyenne | Logs sensibles | A controler avant pilote |
| Moyenne | Retention automatisee | Script present, scheduler non confirme |

## 10. Formulation de securite correcte

> Bevoac V5.1 integre des garde-fous importants pour un pilote B2B: API key tenant, allowlists, onboarding Microsoft, SSRF guard, OIDC admin, Key Vault, private endpoints et DLQ. Ces controles doivent etre completes par tests, pentest, supervision, retention planifiee et validation backup/restore avant production enterprise.
