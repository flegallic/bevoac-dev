# Security model Bevoac V6.1.2 Enterprise Hardened

## Menaces traitees

| Menace | Controle |
|---|---|
| Acces croise tenant via API | API key tenant-scoped + filtres tenant + RLS optionnelle stricte |
| Cle API trop permissive | Scopes fonctionnels |
| Exposition resultats sensibles | JSON complet via endpoint explicite uniquement |
| Injection SQL | Requetes parametrees |
| SSRF scan web | HTTPS obligatoire + blocage localhost/private/internal |
| Bypass gateway | APIM obligatoire + recommandation blocage direct ACA |
| Echec publication worker | Outbox transactionnelle |
| Fuite donnees logs | Correlation ID, eviter secrets, runbook incident |

## RLS

La RLS enterprise hardened exige :

- contexte tenant pour operations tenant-scoped ;
- contexte service pour operations backend de confiance ;
- `FORCE ROW LEVEL SECURITY` ;
- tests de denial ;
- role runtime non-owner en production stricte.

## Perimetre RLS V6.1.2

La migration RLS stricte couvre les tables runtime tenant-scoped utilisees par les scans, resultats, billing, outbox, API keys, web targets et Azure scopes. Elle n'active pas encore FORCE RLS sur `azure_onboarding_sessions` ni `tenant_azure_integrations`, car le callback Microsoft admin-consent doit d'abord etre refactore en transactions service-context dediees et teste de bout en bout.

Cette limite evite une regression fonctionnelle du flux onboarding tout en durcissant les chemins d'execution critiques des scans clients.

## Limites restantes avant certification

- Pentest externe non inclus.
- SCA/SBOM a executer dans CI.
- Tests de charge a produire.
- Revue IAM Azure et APIM a faire sur l'environnement reel.
