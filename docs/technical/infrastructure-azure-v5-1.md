# Infrastructure Azure Bevoac V5.1

## 1. Objectif

Documenter l'IaC Azure V5.1 pour demonstration et pilote B2B cadre.

## 2. Ressources principales

- Resource Group;
- Log Analytics Workspace;
- Azure Container Registry Premium, admin disabled;
- Key Vault avec RBAC, purge protection et soft delete;
- User Assigned Managed Identities API et worker;
- PostgreSQL Flexible Server;
- Azure Service Bus Standard et queue `scan-jobs`;
- VNet et subnet Container Apps;
- NAT Gateway pour IP egress stable;
- Azure Container Apps Environment;
- API Container App publique HTTPS;
- Worker Container App sans ingress;
- private endpoints Key Vault et PostgreSQL;
- Storage static website pour onboarding si active.

## 3. Posture demo / pilote / production

| Usage | Verdict | Conditions |
|---|---|---|
| Demonstration technique | Oui | dataset controle, API key demo, DLQ zero |
| Pilote B2B cadre | Oui sous conditions | OIDC admin, private endpoints, monitoring, tests minimaux, runbook |
| Production limitee | Partiel | outbox, tests, backup/restore, alertes, retention planifiee |
| Production enterprise | Non a date | HA, DR, SLO, pentest, CI/CD, WAF/API gateway, audit trail complet |

## 4. Points securite IaC

- ACR admin disabled;
- Key Vault RBAC;
- purge protection Key Vault;
- Managed Identities pour API/worker;
- Service Bus Data Sender pour API;
- Service Bus Data Receiver pour worker;
- private endpoints optionnels/defaut cible pour Key Vault et PostgreSQL;
- public access PostgreSQL configurable;
- NAT Gateway egress stable.

## 5. Points a ne pas surpromettre

- Terraform state distant chiffre: attendu mais non fourni comme backend code dans ce corpus;
- restore PostgreSQL: non confirme;
- HA multi-zone: non confirme;
- WAF/API Management: non confirme;
- Defender for Cloud/image scanning: non confirme;
- CI/CD: non confirme.

## 6. Backlog infrastructure

| Priorite | Sujet | Objectif |
|---|---|---|
| P1 | remote backend Terraform | eviter state local |
| P1 | action group et alertes completes | DLQ, erreurs API, erreurs worker, CPU/connexions PG |
| P1 | backup/restore teste | preuve exploitation |
| P1 | Container Apps Job retention | retention automatisee |
| P2 | WAF/API gateway | protection API publique |
| P2 | image scanning | supply chain |
| P2 | HA PostgreSQL | production limitee/prod enterprise |
