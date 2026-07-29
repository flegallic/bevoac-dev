# Bevoac V5.3 - Release evidence checklist

| Gate | Command / evidence | Expected |
|---|---|---|
| API check | `npm run check` | OK |
| API tests | `npm test` | OK |
| DB migrations | `npm run migrate-db` | OK |
| Tenant isolation | `npm run check:tenant-isolation` | OK |
| Worker check | `npm run check` | OK |
| Terraform | `terraform validate` | OK |
| Static IaC | `bash scripts/static-hardening-check.sh` | OK |
| Outbox publisher | `terraform output -raw outbox_publisher_container_app_name` | non-empty |
| APIM | `bash scripts/apim-smoke-test.sh` | OK |
| Service Bus | `deadLetter=0` outside intentional tests | OK |
| Load proof | `k6 run tests/load/k6-multitenant-b2b-v5-3.js` | criteria met |
| Residual risks | `production-acceptance-v5-3.md` attached to release | signed-off |
