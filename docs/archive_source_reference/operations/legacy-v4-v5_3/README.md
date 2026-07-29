# Bevoac documentation V5.2 pilot hardening

Version documentaire: V5.2 pilot hardening  
Statut: pilote B2B cadre  
Destinataire: interne technique, avant extraction client-safe  
Derniere consolidation: 2026-05-31

## Finalite du corpus

Ce dossier est la source documentaire active pour Bevoac V5.2. Il remplace les formulations V5.1 qui indiquaient encore comme backlog des elements maintenant livres et testes: idempotency key serveur, transactional outbox, contrats API/worker synchronises, migrations versionnees, billing reserved/consumed/refunded, retention scheduler, alerting Azure Monitor, APIM optionnel et workflow CI.

## Perimetre V5.2 pilote

Bevoac V5.2 couvre:

- API SaaS Azure-first;
- scans web autorises par allowlist tenant;
- onboarding Azure via Microsoft admin consent;
- scans Azure infrastructure sur scopes verifies;
- JSON API complet;
- PDF finding/remediation/evidence;
- historique de scans;
- idempotence serveur et client;
- outbox transactionnelle;
- worker asynchrone idempotent;
- billing state `RESERVED`, `CONSUMED`, `REFUNDED`;
- retention scheduler Azure Container Apps Job;
- alerting Azure Monitor;
- APIM optionnel;
- CI GitHub API/worker/Terraform.

## Hors perimetre actif

Ne pas presenter comme livre:

- runtime AWS ou GCP;
- certification enterprise-ready;
- certification ISO 27001;
- remplacement d'une CNAPP complete;
- sandbox dedie par scan;
- modele Azure cross-tenant zero-secret;
- RLS PostgreSQL;
- pentest valide;
- backup/restore teste;
- load test multi-tenant enterprise.

## Documentation active

### Technique

- `technical/architecture-v5-2.md`
- `technical/api-contract-v5-2.md`
- `technical/security-model-v5-2.md`
- `technical/data-model-v5-2.md`

### Operations

- `operations/runbook-v5-2.md`
- `operations/pilot-validation-runbook-v5-2.md`
- `operations/private-network-terraform-v5-2.md`
- `operations/backup-restore-runbook-v5-2.md`
- `operations/pentest-readiness-v5-2.md`
- `operations/load-test-multitenant-v5-2.md`
- `operations/rls-decision-record-v5-2.md`

### Client-safe

- `client/client-presentation-safe-v5-2.md`

## Regles de redaction

- Toute information non prouvee doit etre marquee: `Non confirme dans le depot analyse`.
- Ne pas utiliser `enterprise-ready` hors objectif futur.
- Ne pas presenter AWS/GCP comme livre.
- `scan_results` est la source courante du resultat complet.
- `scans.result` est legacy.
- Les captures de test ne doivent jamais contenir API keys, secrets ou tokens.
