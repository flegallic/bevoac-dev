# Incident response Bevoac V6.2.0

## Severity

- SEV1: suspected cross-tenant exposure, secret compromise, data loss, total outage;
- SEV2: growing DLQ, worker blocked, database near saturation, broad onboarding failure;
- SEV3: individual module/provider degradation, latency, report failure;
- SEV4: isolated warning or documentation defect.

## Lifecycle

```text
detect -> qualify -> assign -> contain -> preserve evidence -> diagnose -> restore/rollback -> validate -> communicate -> postmortem
```

## Mandatory playbooks

- DLQ and replay;
- PostgreSQL unavailable or saturated;
- secret compromise/rotation;
- suspected cross-tenant access;
- failed release;
- provider throttling;
- PDF/reporting failure.

## Evidence

Record timestamps, commit, revision, affected tenants, logs, actions, communication, recovery, root cause and follow-up owners. Never place secret values in the incident record.
