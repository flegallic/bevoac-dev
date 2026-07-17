# Bevoac V5.3 multi-tenant load test

Purpose: prove that Bevoac can accept concurrent client traffic from at least two tenants without cross-tenant leakage, unexpected 5xx errors, or unbounded queue backlog.

## Prerequisites

- Two active Bevoac tenants.
- Two active API keys.
- Each tenant has its own registered web target.
- API, worker, outbox publisher and Service Bus are deployed.

## Run

```bash
API_BASE_URL="https://<api-or-apim>" \
BEVOAC_API_KEY_A="biv_live_..." \
BEVOAC_API_KEY_B="biv_live_..." \
BEVOAC_TARGET_URL_A="https://example-a.com" \
BEVOAC_TARGET_URL_B="https://example-b.com" \
TENANT_A_VUS=3 \
TENANT_B_VUS=3 \
TEST_DURATION=3m \
k6 run tests/load/k6-multitenant-b2b-v5-3.js
```

## Acceptance criteria

- `http_req_failed < 5%`.
- p95 HTTP duration under 1500 ms for create calls.
- 429 is acceptable when tenant backpressure is intentionally hit.
- No unexpected 5xx.
- Service Bus DLQ remains 0 after worker catches up.
- No scan remains `PENDING` for more than the operational threshold.
- API list/detail calls remain tenant-scoped in post-test spot checks.
