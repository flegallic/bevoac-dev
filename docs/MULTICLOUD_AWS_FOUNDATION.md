# Bevoac multi-cloud AWS foundation

## Verdict

Le chantier AWS peut commencer apres application du hardening, mais il ne faut pas ajouter directement du code AWS dans `audit-runner` sans abstraction provider.

## Etapes AWS obligatoires

| Priorite | Zone | Action | Sortie attendue |
|---|---|---|---|
| P0 | Contrat | Definir contrat V7 provider-neutral | Schema JSON versionne |
| P0 | Credentials | AWS AssumeRole + ExternalId | Aucun secret AWS client stocke |
| P0 | Isolation | Mapping tenant -> account/role/regions | Acces croise impossible par design |
| P1 | Preflight | Comptage comptes/regions/ressources | Blocage quota avant scan |
| P1 | Modules | IAM, S3, EC2/SG, KMS, CloudTrail, Config, RDS, Costs | Findings normalises |
| P1 | Worker | Provider registry | Azure et AWS decouples |
| P1 | Tests | Fixtures AWS + mocks SDK | Non-regression |
| P2 | Docs client | Procedure onboarding AWS | Exploitable par integrateur/RSSI |

## Pourquoi AWS n'est pas active dans ce package

Accepter `cloudProvider=aws` sans scanner AWS complet creerait une API mensongere et risquerait de casser le worker. Le package installe donc la fondation, le schema cible et le registry, mais garde AWS desactive.
