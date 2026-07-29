# Runbook Bevoac V5.3 Production Ready - Rebase V4.2 Client B2B

Ce runbook Word est le document actif. Il reprend la profondeur V4.2 et y ajoute les apports V5.2/V5.3 : idempotence serveur, transactional outbox, outbox publisher dédié, migrations versionnées, billing RESERVED/CONSUMED/REFUNDED, APIM, alerting, rétention, tenant guardrails et charge multi-tenant.

Document principal : `docs/Runbook_Bevoac_V5_3_Production_Ready_Rebase_V4_2_Client_B2B.docx`

## Commandes de validation minimales

```bash
cd bevoac-api-enterprise
npm install
npm run check
npm test
npm run migrate-db
npm run check:tenant-isolation

cd ../bevoac-worker-enterprise
npm install
npm run check

cd ../bevoac-iac-enterprise
terraform fmt -recursive
terraform init -backend=false
terraform validate
bash scripts/static-hardening-check.sh
```

## GO client
GO pilote/production contrôlée si : API/worker/IaC OK, migrations OK, tenant isolation OK, outbox publisher OK, APIM mode documenté, DLQ=0, scan web, scan Azure, PDF, billing, alerting et rétention validés.

## NO-GO enterprise
NO-GO enterprise sans pentest, charge large, runbook incident et décision RLS ou contrôle équivalent.
