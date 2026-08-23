# PostgreSQL backup and restore Bevoac V6.2.0

## Principle

A configured Azure backup window is a capability, not recovery evidence.

## Restore drill

1. Select a controlled point in time.
2. Restore to a separate temporary server.
3. Measure provisioning and validation duration.
4. Validate migrations, tables, constraints, roles, grants, forced RLS and tenant A/B isolation.
5. Validate a non-sensitive sentinel record.
6. Record observed RPO and RTO.
7. Delete the temporary server after approval.
8. Archive the evidence and cost.

## Release gate

No production recovery claim is permitted until the restore drill succeeds. HA, geo-redundant backup, auto-grow and read replica are separate documented decisions based on SLA and budget.
