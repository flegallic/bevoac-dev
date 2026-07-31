# Bevoac V6.1.3 Final Deployment Safety Package

## Purpose

Consolidate the remaining production-deployment safeguards for the staged V6.1.3 rollout. This package is based on `v6.1.3-ops-hotfix-2` and covers the complete Terraform workload and security-finalization chain rather than a single isolated plan defect.

## Workload migration safeguards

- Preserve the application-scoped `pg-password` references required by pre-V6.1.3 API, worker, outbox, and retention configurations until legacy revisions are explicitly retired.
- Preserve `admin-api-secret` on the public API and `servicebus-connection-string` on the worker during the rollback-compatible workload phase.
- Preserve the legacy API managed identity on outbox and retention while it can still be required for rollback.
- Snapshot the live Key Vault public-network and ACL posture before `plan-workloads` and require an exact Terraform no-op for Key Vault and PostgreSQL networking.
- Keep Service Bus local authentication and the legacy connection secret available until Managed Identity smoke tests and traffic promotion are complete.
- Pin API and worker images to the already qualified ACR SHA-256 digests instead of deploying mutable tags.

## Plan integrity and semantic gates

- Validate the full workload plan, including the exact changed-resource set, state moves, traffic weights, images, identities, secret references, database roles, Service Bus authentication, and network no-op requirements.
- Validate the complete security-finalization plan, including the approved deletion set, private endpoints, application cleanup, Key Vault default-deny posture, PostgreSQL public-access closure, and Service Bus local-auth closure.
- Bind each approved plan to its binary plan, JSON rendering, release variables, release context, Git commit, release tag, and immutable image references through SHA-256 manifests.
- Revalidate the manifest and semantic plan immediately before each Terraform apply.
- Add unit tests for both workload and security plan gates and execute them in the static hardening gate.
- Trigger GitHub Actions for `hotfix/**` pushes as well as pull requests.

## Rollout and rollback boundary

- Keep the candidate at zero traffic until workload smoke tests pass.
- Retain progressive 5/25/100 traffic rollout with automatic traffic rollback on failed health checks.
- Introduce an explicit, approved legacy-revision retirement step after the candidate owns 100 percent traffic.
- Deactivate every active API revision except the promoted candidate before application-scoped legacy secrets and identities can be removed.
- Record and verify local retirement and security-apply markers to prevent stale or out-of-order commands.
- Block traffic rollback after security finalization has removed the compatibility resources.

## Final verification

- Verify that only the promoted API revision remains active and owns 100 percent traffic.
- Verify dedicated images, identities, PostgreSQL roles, and Key Vault secret references for API, worker, outbox, retention, and admin API.
- Verify removal of legacy Container Apps secrets and identities, broad Key Vault roles, secret-scoped compatibility roles, API Service Bus Sender, and the Service Bus connection secret.
- Verify Key Vault public access disabled with bypass `None`, default action `Deny`, and no public IP or VNet ACL rules.
- Verify PostgreSQL public access disabled and Service Bus local authentication disabled.
- Re-run application, APIM, queue, PostgreSQL/RLS, and outbox backlog smoke checks.

## Runtime impact

- No application image rebuild is required; the existing qualified image digests remain authoritative.
- No repeat PostgreSQL migration is required when the runtime database boundary already verifies successfully.
- No Azure or Terraform-state change is made by the preparation script itself.

Production behavior must still be confirmed through the generated semantic plans and the staged smoke gates before each approved apply and traffic transition.
