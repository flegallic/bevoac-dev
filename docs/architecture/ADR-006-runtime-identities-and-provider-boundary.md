# ADR-006 — Runtime identities, staged hardening and provider boundary

## Status

Accepted for V6.1.3.

## Decision

1. Bind PostgreSQL security to real login roles and `session_user`.
2. Give each workload its own Managed Identity, PostgreSQL login and secret references.
3. Keep the public API out of Service Bus when the dedicated outbox is enabled.
4. Use Managed Identity for Service Bus Sender, Receiver and the worker scale rule.
5. Migrate workloads first; remove legacy rollback access only in a second, approved security-finalization apply.
6. Keep Service Bus Standard on its supported public endpoint with TLS 1.2 and identity-only authentication after finalization.
7. Put provider-specific execution behind a versioned, fail-closed adapter contract.

## Rationale

A mutable application setting is not a security identity. An Internet-facing API must not inherit worker, outbox, retention, administration or schema-owner privileges. A single apply that simultaneously changes database users, identities, queue authentication and private networking would unnecessarily increase blast radius and reduce rollback options. The staged decision preserves continuity while still making legacy access explicitly temporary and testable.

The durable outbox insert remains in the same PostgreSQL transaction as scan creation. Service Bus publication is performed by a separate runtime, reducing the public API privilege and secret surface.

Service Bus Standard supports the required sessions but not Private Link. V6.1.3 therefore closes SAS/local authentication and relies on workload RBAC without making an unsupported private-network claim. Premium is a separate capacity, cost and migration decision.

## Consequences

- Public API compromise does not confer other workload database privileges.
- During Phase 1, old broad RBAC/SAS resources remain conditionally present solely as a rollback bridge.
- Phase 2 is a mandatory enterprise acceptance gate and verifies their removal.
- Worker scale-to-zero remains available through the user-assigned Managed Identity Service Bus scaler.
- AWS/GCP can be built without changing tenant isolation, billing, outbox, persistence or reporting, but remain disabled until their evidence is complete.
