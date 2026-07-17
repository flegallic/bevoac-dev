# Package audit report - Bevoac V6.1.2 enterprise hardening

## Validation executed in this environment

- Package file inventory checked.
- JavaScript syntax checked with `node --check` for every `.js` file included in the package.
- Runbook DOCX generated from Markdown.
- Runbook DOCX rendered to PNG and PDF using LibreOffice through the DOCX skill renderer.
- All 5 rendered pages were visually inspected: no clipping, no missing glyphs, no broken table, no footer overlap.

## Important boundary

The container could not clone GitHub directly because DNS/network resolution to github.com was unavailable. The patch was therefore built from the files retrieved through the GitHub connector and delivered as an in-place patch package with validation scripts. The package itself is syntactically validated, but it must still be applied to a real working branch and validated with `npm test`, database migrations and Terraform on your environment.

## Claims not made by this package alone

This package does not by itself prove:

- external pentest validation;
- formal enterprise certification;
- zero-risk tenant isolation in the mathematical sense;
- production load capacity;
- absence of vulnerable dependencies.

Those require external evidence after application. The package deliberately avoids claiming certification without such evidence.

## Main corrections included

- API key scopes.
- Tenant-aware DB context.
- Enterprise RLS migration with forced RLS on runtime tenant-scoped tables used by scan, billing, outbox, result and target authorization paths.
- Onboarding API routes protected with explicit `onboarding:read` and `onboarding:write` scopes.
- DB baseline migration repairing runtime drift.
- Result-store tenant-aware loading.
- JSON full result no longer returned by default.
- Explicit `/v1/scans/:scanId/result` endpoint.
- Findings collector shared by API and worker.
- Worker result summary and DB updates tenant-context aware.
- Outbox publisher service-context aware.
- Documentation enterprise hardened.
- AWS foundation scaffold without unsafe runtime activation.

## RLS boundary retained deliberately

`azure_onboarding_sessions` and `tenant_azure_integrations` are not forced under RLS by this migration because the Microsoft admin-consent callback flow writes them through a signed-state redirect path. The scan/billing/outbox/result/target tables are covered. The onboarding tables remain tenant-filtered at application level and must be moved to explicit service-context transactions before enabling FORCE RLS on them.
