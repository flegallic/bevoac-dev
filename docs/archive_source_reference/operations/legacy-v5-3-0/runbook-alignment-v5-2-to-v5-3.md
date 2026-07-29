# Bevoac documentation alignment - V5.2 to V5.3

| Area | V5.2 state | V5.3 alignment |
|---|---|---|
| Version | V5.2.0-pilot-hardening | V5.3.0-production-acceptance |
| Outbox | Transactional outbox, API publisher | Dedicated outbox publisher Container App recommended |
| Tenant isolation | API filters + application controls | DB guardrails, operator view and `check:tenant-isolation` |
| APIM | Optional gateway | Explicit double-auth / Bevoac-only mode |
| Terraform private Key Vault | Known issue | Preflight + production runner model |
| Load proof | Required but not complete | k6 multi-tenant scenario and acceptance criteria |
| Documentation | V5.2 runbook active | V5.3 ultimate runbook active; V5.2 historical |
