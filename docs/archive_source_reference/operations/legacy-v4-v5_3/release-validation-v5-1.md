# Validation release Bevoac V5.1

## 1. Objectif

Checklist obligatoire avant demonstration ou pilote B2B cadre.

## 2. Code et build

| Controle | Statut attendu |
|---|---|
| API `npm run check` | OK |
| Worker `npm run check` | OK |
| Terraform fmt | OK |
| Terraform validate | OK |
| Images API/worker build | OK |
| Images push ACR | OK |

## 3. Contrat API/worker

```bash
grep -R "2026-04-28" -n .
grep -R "2026-05-06-production-hardening-v5" -n contracts bevoac-api-enterprise/contracts bevoac-worker-enterprise/contracts
```

Attendu:

- aucune version obsolete active;
- API et worker alignes.

## 4. Securite

| Controle | Attendu |
|---|---|
| Admin OIDC | actif |
| Shared secret admin | desactive en prod/pilote securise |
| Key Vault public access | ferme si private endpoints |
| PostgreSQL public access | ferme si private endpoints |
| API key demo | non exposee |
| Secrets | Key Vault |
| PG SSL | verify-full |

## 5. Onboarding

- Microsoft admin consent OK;
- session callback consommee une seule fois;
- subscriptions visibles;
- scopes `VERIFIED`;
- statut onboarding lisible via API.

## 6. Scans

| Scenario | Attendu |
|---|---|
| scan web | `DONE` ou `FAILED` avec erreur expliquee |
| scan infra | preflight resource count, modules presents |
| scan full | web + Azure/Entra selon scopes |
| scan trop volumineux | `RESOURCE_LIMIT_EXCEEDED` propre |
| scan sans scope | refus clair |
| scan target non allowlist | refus clair |

## 7. PDF

Verifier que le PDF contient:

- Audit context;
- Report scope and evidence model;
- Executive Summary;
- Severity distribution;
- Module summary;
- Top risks;
- Remediation priorities;
- Control Matrix;
- Technical Evidence Appendix;
- Methodology.

## 8. Service Bus et worker

```bash
az servicebus queue show   --resource-group "$RESOURCE_GROUP"   --namespace-name "$SERVICE_BUS_NAMESPACE_SHORT"   --name scan-jobs   --query "{requiresSession:requiresSession,active:countDetails.activeMessageCount,deadLetter:countDetails.deadLetterMessageCount}"   -o json
```

Attendu apres traitement:

```json
{"requiresSession":true,"active":0,"deadLetter":0}
```

## 9. Load test minimum

Le script k6 doit etre execute et conserve comme preuve de validation.

Minimum attendu pour pilote:

- API reste disponible;
- 429 acceptes si backpressure;
- DLQ reste a zero;
- pas de saturation PostgreSQL;
- logs sans erreurs critiques.

## 10. Sortie release

La release est presentable en pilote lorsque:

- les controles ci-dessus sont OK;
- les ecarts P0 sont documentes;
- les limites sont explicites;
- les preuves de demo sont archivees.
