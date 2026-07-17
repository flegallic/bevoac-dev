# One-command Azure deployment

This deployment does not modify the existing Terraform state.

It performs only these operations:

1. Build the Next.js frontend Docker image.
2. Push it to the existing ACR.
3. Create or reuse a managed identity.
4. Assign `AcrPull` to that identity.
5. Create or update the frontend Azure Container App.
6. Print the public frontend URL.

## Usage

From the `bevoac-frontend-enterprise` folder:

```bash
cp deploy/prod.env.example deploy/prod.env
chmod +x deploy/deploy-azure.sh
./deploy/deploy-azure.sh
```

The included `prod.env.example` is already aligned with:

- resource group: `rg-bevoac-prod`
- ACR: `acrbevoacprod`
- Container Apps environment: `cae-bevoac-prod`
- image: `acrbevoacprod.azurecr.io/bevoac-frontend-enterprise:v1.0.0`
- API: `https://apim-bevoac-prod.azure-api.net/v1/health`

## Customer API keys

Customer `BEVOAC_API_KEY` values are not deployed.

Each customer enters their own key in the portal session. The key is sent to the frontend server proxy only for that customer's sync request.

## Re-deploy

Run the same command again:

```bash
./deploy/deploy-azure.sh
```

If the Container App already exists, the script updates it.
