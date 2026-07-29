# Bevoac V6.1.1 - APIM mandatory gateway

## Decision

APIM devient obligatoire pour les clients B2B. Le chemin API direct est reserve aux operateurs ou au break-glass tant qu'une restriction reseau APIM-only stricte n'est pas finalisee.

## Policy gateway requise

- `subscription_required=true`
- `rate-limit`
- `quota product-scoped`
- `validate-content` APIM avec `max-size=1048576`
- `X-Correlation-Id`
- `X-Bevoac-Gateway=apim`

## Validation

```bash
cd bevoac-iac-enterprise
bash scripts/static-hardening-check.sh
```
