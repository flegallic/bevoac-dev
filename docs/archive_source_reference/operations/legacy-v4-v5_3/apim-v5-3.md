# Bevoac V5.3 - APIM operating model

## Modes

V5.3 makes APIM authentication mode explicit.

| Mode | Terraform | Client headers |
|---|---|---|
| Gateway double-auth | `apim_subscription_required = true` | `Ocp-Apim-Subscription-Key` + `Authorization: Bearer <Bevoac API key>` |
| Bevoac-only auth | `apim_subscription_required = false` | `Authorization: Bearer <Bevoac API key>` |

Default is `true` because it is safer for partner gateway scenarios, but it must be documented for integrators.

## Smoke test

```bash
export APIM_URL="$(terraform output -raw apim_gateway_url)"
export APIM_SUBSCRIPTION_REQUIRED="$(terraform output -raw apim_subscription_required)"
export BEVOAC_API_KEY="biv_live_..."

# If APIM_SUBSCRIPTION_REQUIRED=true:
export APIM_NAME="apim-bevoac-prod"
export APIM_SUBSCRIPTION_KEY="$(bash scripts/get-apim-subscription-key.sh)"

bash scripts/apim-smoke-test.sh
```

Expected result:

```text
[OK] APIM smoke test passed.
```
