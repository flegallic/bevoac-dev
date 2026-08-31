# Frontend onboarding Bevoac V4

Frontend statique de démonstration client. Il ne construit pas lui-même l'URL Microsoft : il appelle l'API Bevoac, qui crée une session sécurisée et retourne `authorizationUrl`.

## Flux

1. L'administrateur client ouvre le portail.
2. Il saisit l'URL API Bevoac et sa clé API client.
3. Le frontend appelle `POST /v1/onboarding/azure/start`.
4. L'API crée une session courte, signe un `state` HMAC, stocke le hash et renvoie l'URL Microsoft admin consent.
5. Le navigateur redirige vers Microsoft.
6. Microsoft retourne vers `https://<api_fqdn>/v1/onboarding/azure/callback`.
7. L'API vérifie `state`, TTL, session, `api_key_id`, admin consent, puis liste les subscriptions accessibles.
8. L'API alimente `tenant_azure_scopes`, puis redirige vers la page API `/v1/onboarding/azure/result` en mode `api`, ou vers `success.html` en mode `legacy_static`.

## Prérequis

- `api_public_base_url` doit être renseigné avant la démo client.
- L'URI `https://<api_fqdn>/v1/onboarding/azure/callback` doit être déclarée dans l'app registration Microsoft Entra.
- En mode `api`, `ONBOARDING_FRONTEND_SUCCESS_URL` reste vide et l'API utilise `/v1/onboarding/azure/result`.
- En mode `legacy_static`, `ONBOARDING_FRONTEND_SUCCESS_URL` pointe vers `success.html` et son origine doit rester dans `ALLOWED_ORIGINS`.
- Le service principal Bevoac doit recevoir le RBAC nécessaire chez le client après consentement.

## Sécurité

La clé API est envoyée uniquement à l'API Bevoac. Elle n'est jamais envoyée à Microsoft. Pour une production complète, remplacer cette page statique par un portail authentifié avec session utilisateur, protection CSRF et stockage secret côté serveur.
