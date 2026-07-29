# Runbook validation client/admin Bevoac V5.2

## Phase 6 - Auth et controle tenant

```bash
curl -s -o /tmp/no-auth.json -w "%{http_code}\n" "$API_BASE_URL/v1/scans"
curl -s -o /tmp/bad-auth.json -w "%{http_code}\n" "$API_BASE_URL/v1/scans" -H "Authorization: Bearer invalid-key"
curl -s -o /tmp/list-scans-a.json -w "%{http_code}\n" "$API_BASE_URL/v1/scans" -H "Authorization: Bearer $BEVOAC_API_KEY_A"
```

Attendu: 401, 401, 200.

Rejet tenant fourni:

```bash
curl -s -o /tmp/tenant-in-body.json -w "%{http_code}\n" \
  -X POST "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY_A" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"00000000-0000-4000-8000-000000000000","cloudProvider":"azure","scanProfile":"web","modules":["web"],"azure":{"targetUrl":"https://example.com"}}'
```

Attendu: 400.

## Phase 7 - Idempotency key serveur

```bash
RESP_SERVER=$(curl -s -X POST "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY_A" \
  -H "Content-Type: application/json" \
  -d '{"cloudProvider":"azure","scanProfile":"web","modules":["web"],"azure":{"targetUrl":"https://example.com"}}')

echo "$RESP_SERVER" | jq .
export SCAN_ID_SERVER=$(echo "$RESP_SERVER" | jq -r '.scanId')
export IDEM_SERVER=$(echo "$RESP_SERVER" | jq -r '.idempotencyKey')

RESP_SERVER_REPLAY=$(curl -s -X POST "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY_A" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEM_SERVER" \
  -d '{"cloudProvider":"azure","scanProfile":"web","modules":["web"],"azure":{"targetUrl":"https://example.com"}}')

test "$(echo "$RESP_SERVER_REPLAY" | jq -r '.scanId')" = "$SCAN_ID_SERVER" && echo "[OK] same scanId"
```

## Phase 9 - Outbox

```sql
SELECT id, aggregate_type, aggregate_id, tenant_id, event_type, status, attempts, published_at, last_error, payload->>'version' AS version, created_at, updated_at
FROM outbox_events
WHERE aggregate_id = '<SCAN_ID_SERVER>'
ORDER BY created_at DESC;

SELECT event_type, aggregate_id, COUNT(*)
FROM outbox_events
GROUP BY event_type, aggregate_id
HAVING COUNT(*) > 1;
```

Attendu: un evenement `scan.requested`, version active, pas de doublon.

## Phase 10 et 11 - Worker et billing

```bash
for i in {1..60}; do
  curl -s "$API_BASE_URL/v1/scans/$SCAN_ID_SERVER?includeResult=false" \
    -H "Authorization: Bearer $BEVOAC_API_KEY_A" \
    | jq '{scanId,status,billingState,nestedBillingState:.billing.billingState,errorMessage,resultSummary}'
  sleep 5
done
```

Attendu: `DONE` et `CONSUMED` pour un scan reussi.

SQL:

```sql
SELECT id, tenant_id, status, billing_state, error_message, result_size_bytes, result_sha256, completed_at
FROM scans
WHERE id = '<SCAN_ID_SERVER>';

SELECT scan_id, tenant_id, compression, result_size_bytes, result_sha256, result_summary
FROM scan_results
WHERE scan_id = '<SCAN_ID_SERVER>';

SELECT attempt_id, scan_id, tenant_id, status, error_message, started_at, completed_at
FROM scan_attempts
WHERE scan_id = '<SCAN_ID_SERVER>'
ORDER BY started_at DESC;

SELECT scan_id, event_type, billing_units, amount_eur_ht, recorded_at
FROM billing_usage_ledger
WHERE scan_id = '<SCAN_ID_SERVER>'
ORDER BY recorded_at ASC;
```

## Phase 13 - Isolation multi-tenant

```bash
curl -s -o /tmp/tenant-b-read-a.json -w "%{http_code}\n" \
  "$API_BASE_URL/v1/scans/$SCAN_ID_SERVER" \
  -H "Authorization: Bearer $BEVOAC_API_KEY_B"

curl -s "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY_B" \
  | jq -r '.[].scanId' | grep -Fx "$SCAN_ID_SERVER" \
  && echo "[KO] Tenant B sees tenant A scan" \
  || echo "[OK] Tenant B does not see tenant A scan"
```

Attendu: 404 et scan absent du listing B.

## Phase 15 - Scan Azure reel

Utiliser un tenant existant avec scope Azure `VERIFIED`.

```sql
SELECT tas.tenant_id, t.company_name, tas.microsoft_tenant_id, tas.subscription_id, tas.display_name, tas.status, tas.is_active, tas.verified_at
FROM tenant_azure_scopes tas
JOIN tenants t ON t.id = tas.tenant_id
WHERE tas.status = 'VERIFIED' AND tas.is_active = TRUE AND tas.subscription_id IS NOT NULL
ORDER BY tas.verified_at DESC NULLS LAST, tas.created_at DESC;
```

```bash
export IDEM_AZURE_RETRY="azure-retry-existing-tenant-$(date +%s)"
RESP_AZURE_RETRY=$(curl -s -X POST "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY_EXISTING" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEM_AZURE_RETRY" \
  -d "{\"cloudProvider\":\"azure\",\"scanProfile\":\"infra\",\"modules\":[\"storage\"],\"azure\":{\"microsoftTenantId\":\"$MICROSOFT_TENANT_ID\",\"subscriptionIds\":[\"$SUBSCRIPTION_ID\"]}}")
echo "$RESP_AZURE_RETRY" | jq .
export SCAN_ID_AZURE_RETRY=$(echo "$RESP_AZURE_RETRY" | jq -r '.scanId')
```

Attendu: scanId non null, puis `DONE/CONSUMED` ou `FAILED/REFUNDED` controle.

## Phase 18 - Alerting

```bash
az monitor metrics alert list \
  --resource-group "$RESOURCE_GROUP" \
  --query "[].{name:name,enabled:enabled,severity:severity}" \
  -o table
```

Attendu: DLQ, backlog, PostgreSQL CPU, memory, storage.

## Phase 19 - APIM

Si `apim_subscription_required=true`, utiliser cle APIM + cle Bevoac:

```bash
export APIM_URL=$(terraform output -raw apim_gateway_url)
export AZURE_SUBSCRIPTION_ID=$(az account show --query id -o tsv)
export APIM_SUBSCRIPTION_NAME="master"
export APIM_SUBSCRIPTION_KEY=$(az rest --method post --url "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ApiManagement/service/apim-bevoac-prod/subscriptions/$APIM_SUBSCRIPTION_NAME/listSecrets?api-version=2022-08-01" --query "primaryKey" -o tsv)

curl -i "$APIM_URL/v1/health" -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"
curl -i "$APIM_URL/v1/scans" -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" -H "Authorization: Bearer $BEVOAC_API_KEY_EXISTING"
```

## Phase 21 - DLQ et scans bloques

```bash
export SERVICEBUS_NAMESPACE_FQDN=$(terraform output -raw service_bus_namespace)
export SERVICEBUS_NAMESPACE=${SERVICEBUS_NAMESPACE_FQDN%%.servicebus.windows.net}
export SERVICEBUS_QUEUE_NAME=$(terraform output -raw service_bus_queue_name)

az servicebus queue show \
  --resource-group "$RESOURCE_GROUP" \
  --namespace-name "$SERVICEBUS_NAMESPACE" \
  --name "$SERVICEBUS_QUEUE_NAME" \
  --query "{active:countDetails.activeMessageCount,deadLetter:countDetails.deadLetterMessageCount,transferDeadLetter:countDetails.transferDeadLetterMessageCount,requiresSession:requiresSession}" \
  -o json
```

Attendu: active=0, deadLetter=0, transferDeadLetter=0 hors test volontaire.
