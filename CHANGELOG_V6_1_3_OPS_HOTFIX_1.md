# Bevoac V6.1.3 operations hotfix 1

## Scope

This hotfix changes deployment and verification tooling only. The published V6.1.3 API and worker image digests are unchanged.

## Corrections

- Use the environment variable names required by `sync-runtime-db-roles.js`.
- Use `ALLOW_RUNTIME_ROLE_SYNC=true` in the release runner.
- Accept PostgreSQL 16 automatic administrative memberships only when they are granted by a superuser to `bevoacadmin` with `ADMIN TRUE`, `INHERIT FALSE`, and `SET FALSE`.
- Reject every privilege-bearing or unexpected runtime-role membership.
- Reproduce the Azure PostgreSQL 16 role-creation path in CI by creating runtime roles through the non-superuser `bevoacadmin` account.

## Production observation

Azure PostgreSQL 16 created six administrative memberships with grantor `azuresu`. These memberships do not grant inherited runtime privileges and do not permit `SET ROLE`.
