# Bevoac V6.1.1 - CI release lock

## Mandatory CI gates

- API: `npm ci || npm install`, `npm run check`, `npm test`
- Worker: `npm ci || npm install`, `npm run check`, `npm test`
- Terraform: `terraform fmt -check -recursive`, `terraform init -backend=false`, `terraform validate`, `bash scripts/static-hardening-check.sh`

## Why worker tests are mandatory

The worker owns scan execution, Service Bus processing, resource preflight, result persistence and billing state transitions. A syntax-only check is not enough after the V6.1.1 `executionStatus=SUCCESS` worker fix.
