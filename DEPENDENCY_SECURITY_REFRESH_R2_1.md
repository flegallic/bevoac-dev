# Bevoac V6.2.0 R2.1 — Dependency Security and Resource Graph Transport

## Scope

R2.1 is a consolidated source revision. It closes the dependency findings discovered during the Node.js 24 qualification without changing Azure resources, Terraform state, PostgreSQL production data, billing rules, tenant-isolation rules, or the public scan contract.

## API

- removes `@fastify/swagger-ui` and its static-file dependency chain;
- keeps `@fastify/swagger` for OpenAPI generation;
- exposes generated OpenAPI JSON only at `/docs/openapi.json` when `SWAGGER_ENABLED=true`;
- keeps the documentation endpoint disabled by default in production;
- locks corrected `find-my-way`, `fast-uri`, and `fast-xml-parser` versions;
- includes the exact API lockfile that passed Node.js 24 checks, 109 tests, and `npm audit` with zero findings on 2026-08-05.

## Worker

The deprecated `@azure/arm-resourcegraph` 4.x dependency and its `@azure/ms-rest-*` / `uuid@8` chain are removed entirely.

Resource Graph queries now use a repository-owned, fail-closed adapter that:

- acquires an Azure Resource Manager token through the existing `@azure/identity` credential;
- sends authenticated POST requests to the Azure Resource Graph REST endpoint using API version `2024-04-01`;
- maps the internal SDK-shaped `top` and `skipToken` options to REST `$top` and `$skipToken`;
- preserves the central pagination, maximum-page and maximum-row controls;
- propagates abort signals and retry classification data;
- never includes service error payloads or access tokens in thrown error messages;
- rejects unsupported request options.

No preview Azure SDK is introduced.

## SBOM

Native `npm sbom` is not a release gate. During qualification it rejected a semver-valid tree (`ajv-formats@3.0.1` satisfying `^3.0.1`) after all API checks, tests, and the audit had passed.

R2.1 instead contains a deterministic CycloneDX 1.6 generator based on npm lockfile v3, plus a structural graph validator. The generated API and worker SBOMs are included under `evidence/sbom/`.

## Release position

This source revision is complete and immutable once `SOURCE_SHA256SUMS` is generated. Production promotion still requires the environmental qualification gates documented in `FINAL_QUALIFICATION_STATUS.md`; those gates are validation activities, not additional source patches.
