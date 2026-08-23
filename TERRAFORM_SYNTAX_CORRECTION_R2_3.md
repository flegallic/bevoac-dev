# Bevoac V6.2.0 R2.3 — Terraform syntax correction

## Reason for the revision

The R2.2 Terraform format gate correctly rejected the following construct in
`bevoac-iac-enterprise/v620-apim-backend-boundary.tf`:

```hcl
condition ? <<XML
...
XML
: ""
```

Terraform parsed the heredoc as the end of the assignment and therefore did
not associate the following colon with the conditional expression.

## Correction

The APIM backend-boundary policy is now generated with `join("\n", [...])`.
This keeps the conditional expression on one unambiguous HCL expression and
preserves the exact XML injected into the APIM API policy.

## Regression protection

`scripts/ci/terraform-static-reference-check.py` now rejects conditional
heredoc constructs (`? <<...`) before a release package is assembled.

## Scope

Only the following runtime-independent source changed from R2.2:

- `bevoac-iac-enterprise/v620-apim-backend-boundary.tf`;
- `scripts/ci/terraform-static-reference-check.py`;
- qualification/documentation/manifests for R2.3.

API code, worker code, database migrations, package manifests and lockfiles are
byte-identical to R2.2. The Node.js 24 and PostgreSQL 16 qualification evidence
therefore remains applicable to those unchanged components.

## Required target-environment gate

R2.3 is not production-approved until the versioned local Terraform runner
successfully completes:

```text
terraform fmt -check -recursive -diff
terraform init -backend=false -input=false -lockfile=readonly
terraform validate -no-color
```

No Terraform plan or apply is performed by that runner.
