#!/usr/bin/env bash
set -euo pipefail

cd bevoac-api-enterprise
npm install
npm run check
npm test
npm run migrate-db
npm run migrate-db:enterprise-hardening
npm run check:enterprise-hardening
ALLOW_ENTERPRISE_RLS_APPLY=true npm run migrate-db:enterprise-rls
npm run check:tenant-isolation:enterprise

cd ../bevoac-worker-enterprise
npm install
npm run check
npm test

cd ../bevoac-iac-enterprise
terraform fmt -recursive
terraform init -backend=false
terraform validate
bash scripts/static-hardening-check.sh
