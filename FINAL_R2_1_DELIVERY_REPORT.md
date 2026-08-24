# Bevoac V6.2.0 R2.1 — Direct Final Source Delivery

## Delivery model

This is a complete source tree. It is not a builder, migration patch, or controller. No earlier R2.1 builder is required and no patch must be applied to this source.

## Immutable basis

- V6.1.3 baseline commit: `d9b85ad728a9f1252ca2acd0b9421cd5ec9a7ba4`
- V6.1.3 exported source SHA-256: `f2448c3a71e05fc06e95457fa59035f3b4e7512c9085162ff026f5a4f091a588`
- V6.2.0 R2 source ZIP SHA-256: `752d72c509de02c298d49c19693f426f2ade1fd0f42afdad47c8f90aa39ce878`
- V6.2.0 R2 source manifest SHA-256: `b2710739c42019b3cd5aed3d0f22d046ec7430271cdf27fade47f2ed8cd416ea`
- R2.1 qualification failure-evidence ZIP SHA-256: `c17b192418e4b3c6718ef537b80d50dff69203bf431f4d98760064a51f582d30`

## Definitive dependency decisions

### API

The exact API dependency tree that passed Node.js 24 checks, tests, and an audit with zero findings is integrated directly. Swagger UI and its static-file runtime chain are removed. OpenAPI JSON remains available only through the explicit, opt-in `/docs/openapi.json` route.

### Worker

The deprecated Resource Graph SDK is not upgraded to a preview or ambiguous package release. It is removed. Resource Graph is accessed through an authenticated Azure Resource Manager REST adapter using the existing `@azure/identity` credential and the `2024-04-01` Resource Graph API.

This removes the complete reported worker chain:

- `@azure/arm-resourcegraph`;
- `@azure/ms-rest-azure-js`;
- `@azure/ms-rest-js`;
- `uuid@8`.

The lockfile contains `fast-uri 3.1.5` and `fast-xml-parser 5.10.1`.

### SBOM

Native `npm sbom` is not used as a release gate. The source contains a deterministic CycloneDX 1.6 generator derived from npm lockfile v3 and a reference-graph validator. API and worker SBOMs are included.

## Security characteristics of the Resource Graph adapter

- fixed Microsoft management endpoint;
- fixed ARM token scope;
- no endpoint controlled by environment or request input;
- UUID validation for subscription identifiers;
- bounded query and pagination parameters;
- allowlist for Resource Graph options;
- abort-signal propagation;
- HTTP status and retry headers preserved for retry classification;
- service response payloads and tokens excluded from thrown messages;
- pagination `$skipToken` supported without a 1,000-row hard ceiling.

## Qualification status

Source modification is closed. Production promotion remains blocked until the environmental gates in `FINAL_QUALIFICATION_STATUS.md` are completed against this immutable source and recorded in the evidence pack.
