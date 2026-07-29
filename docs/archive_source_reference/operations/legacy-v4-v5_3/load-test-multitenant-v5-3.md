# Bevoac V5.3 - Multi-tenant load proof

## Purpose

The V5.3 load test demonstrates that Bevoac can accept concurrent scan creation traffic from multiple tenants without unexpected 5xx responses and without DLQ growth.

## Run

```bash
API_BASE_URL="https://<api-or-apim>" \
BEVOAC_API_KEY_A="biv_live_..." \
BEVOAC_API_KEY_B="biv_live_..." \
BEVOAC_TARGET_URL_A="https://tenant-a.example" \
BEVOAC_TARGET_URL_B="https://tenant-b.example" \
TENANT_A_VUS=3 \
TENANT_B_VUS=3 \
TEST_DURATION=3m \
k6 run tests/load/k6-multitenant-b2b-v5-3.js
```

## Acceptance criteria

- Unexpected 5xx rate is below 5%.
- 429 is acceptable when tenant backpressure is intentionally reached.
- DLQ remains 0 after the worker catches up.
- No scan remains `PENDING` beyond the operational threshold.
- Cross-tenant API list/detail tests still return the expected 404/absence.
