# Bevoac V6.2.0 R2.2 — PostgreSQL 16 qualification profile

## Purpose

R2.2 replaces the external R2.1 PostgreSQL qualification runner with a single versioned runner inside the immutable source tree:

```text
scripts/qualification/postgres16-local.sh
```

The runner executes the existing enterprise database gate against a disposable `postgres:16-alpine` container. It never connects to Azure PostgreSQL or modifies a production database.

## Corrections

- the disposable local database uses `NODE_ENV=test` with `PG_SSL_MODE=disable`;
- the production fail-closed rule remains unchanged and continues to reject disabled TLS;
- Node.js 24 is selected without hiding the original Docker Desktop paths;
- Docker is invoked by its absolute path;
- the current Docker endpoint is retained;
- public image pull can fall back to an isolated anonymous Docker configuration without changing `~/.docker/config.json`;
- the image ID and repository digest are recorded;
- the container starts from the exact resolved image ID;
- package files and lockfiles are hashed before and after the gate;
- the source manifest is verified before and after execution;
- evidence is zipped for review;
- the disposable work tree and container are removed after success.

## Production invariant

The following remains forbidden and is tested elsewhere in the V6.2.0 source:

```text
NODE_ENV=production
PG_SSL_MODE=disable
```

## Expected success markers

```text
SOURCE_REVISION=R2.2
POSTGRES_SERVER_VERSION=16...
POSTGRES_ENTERPRISE_GATE_OK=true
PACKAGE_AND_LOCKFILES_UNCHANGED=true
SOURCE_BASELINE_UNCHANGED=true
AZURE_CONFIGURATION_MODIFIED=false
TERRAFORM_STATE_MODIFIED=false
POSTGRESQL_PRODUCTION_MUTATION_EXECUTED=false
POSTGRES16_QUALIFICATION_OK=true
EVIDENCE_ZIP=...
```
