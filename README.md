# Bevoac V6.1.2 - Enterprise hardening/refactoring package

Ce package est un lot de durcissement et de refactoring pour Bevoac V6.1.2. Il vise a faire passer le socle actuel d'un **pilote B2B avance / production controlee Azure-first** vers une base beaucoup plus credible pour une production enterprise.

## Positionnement honnete du package

Ce package corrige des ecarts concrets observes dans le depot :

- incoherence de baseline DB avec le runtime billing/outbox/result-store ;
- exposition du JSON complet par defaut sur `GET /v1/scans/:scanId` ;
- absence de scopes fonctionnels sur les API keys ;
- RLS presente mais non cablee proprement au contexte applicatif ;
- collector de findings duplique et incomplet ;
- besoin d'une base multi-cloud avant le chantier AWS ;
- documentation V6.1.2 a stabiliser.

Il ne pretend pas fournir a lui seul une certification externe, un pentest externe valide, ou une garantie mathematique "zero-risk". Ces mentions ne doivent etre utilisees commercialement qu'apres execution d'un pentest independant, preuves RLS runtime, revue IAM/IaC, SCA/SBOM et validation de charge.

## Contenu

- `files/` : fichiers a copier dans le depot Bevoac.
- `scripts/apply_enterprise_hardening.py` : applique le lot de facon idempotente avec sauvegarde locale.
- `scripts/validate_package.py` : verifie l'integrite du package et la syntaxe JS des fichiers fournis.
- `docs/` : documentation corrigee et complete a installer dans le depot.

## Application rapide

Depuis la racine du depot Bevoac :

```bash
python /chemin/vers/bevoac_enterprise_grade_v6_1_2_patch/scripts/apply_enterprise_hardening.py --repo-root . --package-root /chemin/vers/bevoac_enterprise_grade_v6_1_2_patch
```

Puis executer les validations :

```bash
cd bevoac-api-enterprise
npm install
npm run check
npm test
npm run migrate-db
npm run check:enterprise-hardening

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

Pour activer la RLS enterprise stricte apres validation sur environnement non-production :

```bash
cd bevoac-api-enterprise
ALLOW_ENTERPRISE_RLS_APPLY=true npm run migrate-db:enterprise-rls
npm run check:tenant-isolation:enterprise
```

## Fichiers principaux remplaces ou ajoutes

- API : `src/routes/scans.js`, `src/services/scan-service.js`, `src/services/result-store.js`, `src/services/billing-service.js`, `src/services/outbox-service.js`, `src/plugins/auth-api-key.js`.
- API new libs : `db-context.js`, `findings-collector.js`, `api-scopes.js`, `cloud-provider-contract.js`, `error-sanitizer.js`.
- DB : migration enterprise baseline + migration RLS stricte optionnelle.
- Worker : `src/services/scan-store.js`, `src/lib/db-context.js`, `src/lib/findings-collector.js`, provider registry AWS scaffold.
- Docs : runbook enterprise hardened, architecture, security model, multi-cloud AWS foundation, validation matrix.

## Point cle AWS

Le package **prepare** AWS par une abstraction provider et un contrat cible, mais ne force pas l'activation runtime AWS tant que le scanner AWS n'est pas implemente et teste. C'est volontaire : accepter `cloudProvider=aws` sans worker AWS fonctionnel serait une regression production.
