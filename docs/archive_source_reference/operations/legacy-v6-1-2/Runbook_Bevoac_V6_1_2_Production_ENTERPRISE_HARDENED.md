# Runbook Bevoac V6.1.2 Production - Enterprise Hardened

## 1. Statut du runbook

Ce runbook est la version enterprise hardened a utiliser pour la validation technique V6.1.2. Il ne supprime pas le DOCX historique `docs/Runbook_Bevoac_V6_1_2_Production.docx`. Il le complete avec une version texte auditable, diffable et exploitable en CI.

## 2. Positionnement production

Bevoac V6.1.2 enterprise hardened est positionne comme :

- production limitee controlee Azure-first ;
- pilote B2B avance ;
- socle pret a durcir vers enterprise-grade ;
- base de refactoring avant AWS/multi-cloud.

Ne pas promettre sans preuve externe :

- enterprise-certified ;
- pentest-validated ;
- zero-risk tenant isolation ;
- multi-cloud runtime complet.

Ces mentions deviennent acceptables uniquement apres : pentest independant, SCA/SBOM, tests RLS runtime, revue IAM/IaC, tests de charge et validation runbook.

## 3. Architecture runtime

Flux principal :

1. Client appelle APIM avec subscription key et API key Bevoac.
2. API Fastify authentifie la cle, derive `tenantId`, charge les scopes.
3. API valide la cible web/Azure autorisee pour le tenant.
4. API reserve billing/quota et cree le scan dans PostgreSQL.
5. API ecrit un evenement outbox transactionnel.
6. Publisher outbox publie vers Azure Service Bus.
7. Worker consomme le message, execute les modules de scan, persiste resultat et summary.
8. Client lit statut, resultats JSON explicites ou PDF.

## 4. Securite API

Obligatoire :

- APIM active ;
- `subscription_required = true` ;
- rate limit APIM ;
- quota APIM product ;
- API key tenant-scoped ;
- scopes API key ;
- OIDC pour routes admin ;
- aucun `tenantId` accepte dans body client ;
- JSON complet uniquement via `/v1/scans/:scanId/result`.

## 5. Scopes API keys

Scopes standards :

- `scan:create` : creer un scan ;
- `scan:read` : lire metadata/statut ;
- `scan:result:read` : lire JSON complet ;
- `scan:pdf:read` : generer un PDF ;
- `billing:read` : lire consommation ;
- `onboarding:read` : lire onboarding ;
- `onboarding:write` : lancer/verifier onboarding.

Une cle compromise ne doit pas donner tout le perimetre par defaut dans les nouveaux deploiements.

## 6. RLS PostgreSQL

### 6.1 Baseline

Appliquer d'abord :

```bash
cd bevoac-api-enterprise
npm run migrate-db
npm run migrate-db:enterprise-hardening
npm run check:enterprise-hardening
```

### 6.2 RLS stricte

Activer uniquement apres test sur environnement non-production :

```bash
ALLOW_ENTERPRISE_RLS_APPLY=true npm run migrate-db:enterprise-rls
npm run check:tenant-isolation:enterprise
```

La RLS stricte force :

- `ENABLE ROW LEVEL SECURITY` ;
- `FORCE ROW LEVEL SECURITY` ;
- policies tenant-scoped ;
- contexte DB explicite `app.current_tenant_id` ;
- contexte service uniquement pour composants backend de confiance.

## 7. Validation DB obligatoire

```bash
npm run check:enterprise-hardening
```

Ce controle verifie :

- tables `scan_results`, `scan_attempts`, `outbox_events` ;
- colonnes runtime manquantes ;
- events billing `scan_reserved`, `scan_consumed`, `scan_refunded` ;
- scopes API keys ;
- idempotency key source.

## 8. Validation API

```bash
npm run check
npm test
```

Tests fonctionnels manuels :

```bash
curl -s "$API_BASE_URL/v1/scans/$SCAN_ID" -H "Authorization: Bearer $BEVOAC_API_KEY"
curl -s "$API_BASE_URL/v1/scans/$SCAN_ID/result" -H "Authorization: Bearer $BEVOAC_API_KEY"
curl -s -L "$API_BASE_URL/v1/scans/$SCAN_ID/pdf" -H "Authorization: Bearer $BEVOAC_API_KEY" -o report.pdf
```

Attendu :

- premier endpoint sans JSON brut ;
- endpoint `/result` avec JSON complet ;
- PDF uniquement si scan `DONE` ou `FAILED` et resultat present.

## 9. Validation worker

```bash
cd bevoac-worker-enterprise
npm run check
npm test
```

Verifier :

- Service Bus sessions si active ;
- DLQ stats ;
- processing attempt ;
- result summary ;
- billing `CONSUMED` ou `REFUNDED` ;
- compression resultats si seuil depasse.

## 10. Validation IaC

```bash
cd bevoac-iac-enterprise
terraform fmt -recursive
terraform init -backend=false
terraform validate
bash scripts/static-hardening-check.sh
```

Verifier que l'URL publique client utilise APIM et non directement Container Apps.

## 11. Incident response

### Scan bloque quota

Symptome : HTTP 429 `MONTHLY_SCAN_QUOTA_EXCEEDED`.

Actions :

1. Verifier `billing/current-month/scans`.
2. Confirmer plan tenant.
3. Ne pas forcer PAYG sur standard/business sans validation commerciale.

### Outbox en echec

Actions :

1. Verifier `outbox_events` status `FAILED`.
2. Verifier Service Bus permissions managed identity.
3. Relancer publisher ou attendre backoff.
4. Si DLQ cote Service Bus, analyser dead-letter reason avant replay.

### Worker failed

Actions :

1. Lire `scan_attempts`.
2. Lire `error_message` scan.
3. Verifier `result_summary` et `result_sha256`.
4. Si erreur transitoire Azure SDK, relancer un nouveau scan apres controle quota.

### Suspicion acces croise tenant

Actions immediates :

1. Desactiver les API keys du tenant concerne.
2. Verifier logs APIM/API par correlation ID.
3. Executer `npm run check:tenant-isolation:enterprise` sur copie de prod ou environnement miroir.
4. Exporter `admin_audit_log`, `scan_attempts`, `outbox_events`.
5. Ne pas supprimer les preuves avant analyse.

## 12. AWS / multi-cloud

AWS n'est pas runtime-enabled dans V6.1.2 enterprise hardened. Le chantier AWS doit commencer par :

- contrat provider-neutral ;
- modele credentials AWS AssumeRole + ExternalId ;
- verification ownership account/organization ;
- preflight ressources ;
- modules IAM/S3/EC2/SG/KMS/CloudTrail/Config/RDS/Cost ;
- normalisation findings ;
- tests isolation tenant ;
- documentation client.

## 13. Go / No-Go production enterprise

No-Go si un seul point est faux :

- tests API KO ;
- tests worker KO ;
- migration DB KO ;
- RLS stricte non testee ;
- APIM contourne ;
- JSON brut expose par defaut ;
- runbook non relu ;
- absence de preuve de restauration DB ;
- absence d'audit dependances ;
- absence de validation PDF.
