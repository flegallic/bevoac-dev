# API contract Bevoac V6.2.0

## Public API

The Azure public API remains `/v1`.

## Request validation

Fastify schemas constrain bodies, UUID parameters, pagination, provider, profile, modules, targets and onboarding values. Unknown properties are rejected on protected mutation routes.

## Idempotency

Header:

```text
Idempotency-Key: opaque-client-key
```

Semantics:

- absent: server generates a key;
- same key and same canonical request: HTTP 200 replay;
- same key and different canonical request: HTTP 409 with `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`;
- new request: HTTP 201.

## Error model

Customer responses contain a stable public code, safe message and correlation ID. Provider stack traces, tokens, request objects and internal endpoints are not persisted in customer results.

## Health

- `/v1/health/live`: process liveness;
- `/v1/health/ready`: bounded dependency readiness;
- `/v1/health/deep`: authenticated operational diagnostics.

## Caching

Scan, billing, onboarding and administration responses are emitted with `Cache-Control: no-store, private` and related cache-prevention headers.
## Azure onboarding result

- `/v1/onboarding/azure/callback`: Microsoft Entra callback;
- `/v1/onboarding/azure/result`: public, credential-free, script-free informational page;
- `/v1/onboarding/azure/status`: authenticated status endpoint.

The callback sends status through an approved fragment. It does not place an API key, tenant identifier or reusable credential in the result-page query string.
