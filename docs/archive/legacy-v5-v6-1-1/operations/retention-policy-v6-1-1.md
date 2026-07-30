# Bevoac V6.1.1 - Retention policy by plan

## Decision

Le PDF est genere a la demande a partir du JSON de resultat. La conservation du PDF client correspond donc a la conservation de `scans` et `scan_results`.

| Plan | Retention DONE scans/resultats/PDF generable |
|---|---:|
| free | 30 jours |
| standard | 90 jours |
| business | 180 jours |
| payg | 180 jours |

## Validation

```bash
cd bevoac-api-enterprise
npm test -- tests/retention/retention-policy.test.js

cd ../bevoac-iac-enterprise
bash scripts/check-retention-policy.sh
```
