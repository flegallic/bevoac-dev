# Bevoac Frontend Enterprise - package clé en main

Ce package déploie le portail frontend Bevoac sans modifier ton Terraform existant.

Il fait uniquement ceci :

1. Build l'image Docker du frontend.
2. Push l'image dans `acrbevoacprod.azurecr.io`.
3. Crée ou réutilise l'identité managée `id-bevoac-prod-frontend`.
4. Donne le rôle `AcrPull` à cette identité.
5. Crée ou met à jour la Container App `ca-bevoac-prod-frontend`.
6. Affiche l'URL publique du portail.

## Déploiement

Depuis la racine de ton repo local :

```bash
cd bevoac-frontend-enterprise-turnkey
cp deploy/prod.env.example deploy/prod.env
chmod +x deploy/deploy-azure.sh
./deploy/deploy-azure.sh
```

Tu n'as pas besoin de lancer `terraform apply`.

## Configuration déjà prête

Le fichier `deploy/prod.env.example` est déjà configuré avec :

```env
AZURE_RESOURCE_GROUP=rg-bevoac-prod
ACR_NAME=acrbevoacprod
ACR_LOGIN_SERVER=acrbevoacprod.azurecr.io
CONTAINER_APP_ENV=cae-bevoac-prod
CONTAINER_APP_NAME=ca-bevoac-prod-frontend
MANAGED_IDENTITY_NAME=id-bevoac-prod-frontend
FRONTEND_IMAGE_NAME=bevoac-frontend-enterprise
FRONTEND_IMAGE_TAG=v1.0.0
BEVOAC_API_URL=https://apim-bevoac-prod.azure-api.net/v1/health
BEVOAC_ALLOWED_API_HOSTS=apim-bevoac-prod.azure-api.net
BEVOAC_API_KEY_HEADER=Ocp-Apim-Subscription-Key
```

## Connexion client

Le portail permet à chaque client de saisir :

- l'URL de synchronisation API,
- le header `Ocp-Apim-Subscription-Key`,
- sa clé `BEVOAC_API_KEY`.

Les clés clients ne sont pas mises dans Terraform, GitHub Actions, l'image Docker ou les variables globales Azure.

## Redéploiement

Pour redéployer une nouvelle version :

```bash
cd bevoac-frontend-enterprise-turnkey
./deploy/deploy-azure.sh
```

Si la Container App existe déjà, elle est mise à jour.
