# Bevoac V5.3 - Dedicated outbox publisher

## Goal

V5.3 removes the production dependency on the API process for publishing transactional outbox events. The API still writes `outbox_events` inside the scan creation transaction, but publishing can be handled by a dedicated Container App.

## Terraform variables

```hcl
enable_dedicated_outbox_publisher = true
outbox_publisher_min_replicas     = 1
outbox_publisher_max_replicas     = 1
outbox_publish_interval_ms        = 5000
outbox_publish_batch_size         = 25
outbox_max_attempts               = 10
outbox_base_backoff_seconds       = 15
```

When `enable_dedicated_outbox_publisher=true`, the API runtime receives:

```text
OUTBOX_PUBLISHER_ENABLED=false
OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST=false
```

The dedicated publisher uses the API image and runs:

```bash
node scripts/outbox-publisher-daemon.js
```

## Validation

```bash
terraform output -raw outbox_publisher_container_app_name
az containerapp logs show --resource-group "$RESOURCE_GROUP" --name "$(terraform output -raw outbox_publisher_container_app_name)" --tail 100
```

Expected logs:

```text
Outbox publisher daemon started.
Outbox publisher tick completed.
```

DB validation:

```sql
SELECT status, COUNT(*)
FROM outbox_events
GROUP BY status
ORDER BY status;
```

Nominal state after worker catches up: `PUBLISHED` majority, no old `PENDING`, no old `PROCESSING`.
