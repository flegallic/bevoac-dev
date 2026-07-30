# Bevoac V6.0 - KPI modules and evidence-first reporting

Version: `6.0.0-production-ready`

## Objective

V6.0 strengthens Bevoac as an evidence-first cloud/web audit API. It does not turn Bevoac into HR, IAM lifecycle or Shadow IT tooling. The focus remains:

```text
scan -> evidence -> findings -> remediation -> JSON exhaustive result -> PDF/reporting -> history -> remediation retest
```

## Non-breaking output model

Every module keeps the existing structure:

```json
{
  "status": "SUCCESS",
  "summary": {},
  "checks": [],
  "details": {}
}
```

V6.0 adds optional fields only:

```json
{
  "kpis": [],
  "coverage": {},
  "evidenceMetadata": {}
}
```

Existing clients that read `summary`, `checks` or `details` are not expected to break.

## New internal and scan modules

| Addition | Type | Purpose | Client benefit |
|---|---|---|---|
| `kpi-engine` | internal library | Normalize KPI objects across modules | Makes reports easier for CTO/RSSI review |
| `exposure_map` | scan module | Consolidated public exposure view | High-value executive risk view |
| `diagnostic_coverage` | scan module | Diagnostic settings coverage for critical resources | Shows whether audit logs are enabled |
| `encryption_coverage` | scan module | Encryption-at-rest coverage signals | Supports security posture evidence |
| `azure_rbac_exposure` | scan module | Owner/Contributor/User Access Administrator broad-scope exposure | Highlights excessive Azure permissions |
| `private_link_coverage` | scan module | PaaS Private Endpoint coverage | Shows maturity of private networking |
| `policy_compliance` | scan module | Azure Policy compliance state summary | Reinforces governance posture |
| `identity_admin_posture` | scan module | Privileged Entra identity posture | Adds admin MFA/dormancy evidence without becoming a GRC product |

## Existing module enhancements

| Module | V6.0 enhancement |
|---|---|
| `storage` | Non-public storage KPI, blob public access disabled KPI, TLS, shared key and local user KPIs |
| `logs` | Logging and retention KPIs |
| `vms` | VM encryption, Trusted Launch, managed identity and exposed admin port KPIs |
| `nsg` | Inbound exposure KPIs |
| `keyvault` | Public access, purge protection, private endpoint and RBAC authorization KPIs |
| `db` | Private access, TLS and Allow Azure Services KPIs |
| `governance` | Defender and security policy coverage KPIs |
| `appservices` | HTTPS-only, Basic Auth and FTP hardening KPIs |
| `entra` | MFA user coverage, global admin count, inactive users and high-risk sign-ins KPIs |
| `entra_b2b` | Guest MFA, stale guests and guest admin KPIs |

## Example KPI object

```json
{
  "kpiId": "STORAGE_NON_PUBLIC_COVERAGE",
  "label": "% de comptes de stockage non publics",
  "domain": "cloud_security",
  "numerator": 47,
  "denominator": 50,
  "valuePct": 94,
  "unit": "percent",
  "status": "WARN",
  "threshold": {
    "warningBelow": 95,
    "criticalBelow": 85
  },
  "evidenceSource": "azure_infrastructure.modules.storage.summary.publicStorageAccountsCount"
}
```

## Validation commands

```bash
cd bevoac-api-enterprise
npm install
npm run check
npm test

cd ../bevoac-worker-enterprise
npm install
npm run check
npm test

cd ../bevoac-iac-enterprise
terraform fmt -recursive
terraform init -backend=false
terraform validate
bash scripts/static-hardening-check.sh
```

## Suggested V6.0 scan request

```bash
curl -s -X POST "$API_BASE_URL/v1/scans" \
  -H "Authorization: Bearer $BEVOAC_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: v6-kpi-$(date +%s)" \
  -d '{
    "cloudProvider":"azure",
    "scanProfile":"infra",
    "modules":[
      "storage",
      "keyvault",
      "logs",
      "governance",
      "exposure_map",
      "diagnostic_coverage",
      "encryption_coverage",
      "azure_rbac_exposure",
      "private_link_coverage",
      "policy_compliance"
    ],
    "azure":{
      "microsoftTenantId":"<tenant>",
      "subscriptionIds":["<subscription>"]
    }
  }' | jq .
```

## Limitations deliberately documented

- The new modules remain Azure-first.
- `diagnostic_coverage` and `policy_compliance` rely on Resource Graph visibility.
- `encryption_coverage` distinguishes explicit non-compliance from unknown states.
- `identity_admin_posture` requires Microsoft Graph permissions for roles and MFA registration.
- No HR/offboarding, ticketing, access recertification or Shadow IT traffic discovery is introduced in the core product.
