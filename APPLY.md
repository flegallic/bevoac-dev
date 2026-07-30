# V6.1.3 application and deployment procedure

## 1. Source gate

Work from a dedicated release branch with a clean tracked worktree and an empty Git index.

```bash
./validate_release.sh --full
```

Do not deploy if any API, worker, PostgreSQL CI, Terraform or static-hardening gate fails.

## 2. CI gate

Push the reviewed release commit and require both GitHub Actions jobs to succeed:

- `code-and-iac`;
- `postgres-enterprise`.

The PostgreSQL job rebuilds PostgreSQL 16 from zero, applies the eight expected migrations and validates the six real runtime logins, 15 forced-RLS tables, 29 policies and 58 exact table privileges.

## 3. Staged Azure deployment

```bash
scripts/release/deploy_v6_1_3.sh preflight
scripts/release/deploy_v6_1_3.sh build
BEVOAC_APPROVE_DB_MIGRATION=YES scripts/release/deploy_v6_1_3.sh migrate-db
scripts/release/deploy_v6_1_3.sh plan-workloads
BEVOAC_APPROVE_WORKLOAD_APPLY=YES scripts/release/deploy_v6_1_3.sh apply-workloads
scripts/release/deploy_v6_1_3.sh smoke-workloads
BEVOAC_APPROVE_TRAFFIC_ROLLOUT=YES scripts/release/deploy_v6_1_3.sh rollout
```

The workload phase deliberately preserves the current public-network and legacy Service Bus rollback path. It is not the final security posture.

## 4. Security finalization

Run only from a private runner, VPN or approved administrative path able to resolve and reach Key Vault and PostgreSQL private endpoints.

```bash
BEVOAC_PRIVATE_RUNNER_READY=YES scripts/release/deploy_v6_1_3.sh plan-security
BEVOAC_PRIVATE_RUNNER_READY=YES \
BEVOAC_APPROVE_SECURITY_FINALIZE=YES \
  scripts/release/deploy_v6_1_3.sh apply-security
BEVOAC_PRIVATE_RUNNER_READY=YES scripts/release/deploy_v6_1_3.sh smoke-final
```

This phase closes PostgreSQL and Key Vault public access, disables Service Bus local/SAS authentication, deletes the legacy Service Bus connection-string secret, removes the public API Sender role and removes API/worker vault-wide secret-reader roles.

## 5. Evidence

```bash
BEVOAC_COLLECT_DB=YES scripts/release/collect_post_deploy_evidence.sh
```

Archive the Terraform plans, image digests, migration/RLS report, workload identities and database users, APIM smoke output, revision traffic, queue/DLQ, outbox backlog and final checksums.

## 6. Rollback

Before 100% traffic, use:

```bash
scripts/release/deploy_v6_1_3.sh rollback
```

If security finalization fails, do not improvise. Restore the approved network/RBAC variables through Terraform, retain evidence and return to the last accepted workload state.

## Forbidden shortcuts

- Do not reuse a V6.1.2 image tag.
- Do not apply the blocked legacy RLS launchers.
- Do not put `bevoacadmin` on an application workload.
- Do not remove the transactional `outbox_events` write.
- Do not disable Service Bus local auth before worker/outbox Managed Identity smoke tests pass.
- Do not close Key Vault/PostgreSQL public access without a verified private administrative path.
