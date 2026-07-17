# bevoac-iac-enterprise - V5.1 Azure-first

Terraform Azure pour deploiement Bevoac demonstration ou pilote B2B cadre.

## Ressources

- Resource Group;
- ACR Premium admin disabled;
- Key Vault RBAC et purge protection;
- User Assigned Managed Identities;
- PostgreSQL Flexible Server;
- Service Bus Standard avec queue `scan-jobs`;
- Container Apps Environment dans VNet;
- NAT Gateway egress stable;
- API Container App publique HTTPS;
- Worker Container App sans ingress;
- private endpoints Key Vault/PostgreSQL;
- Log Analytics.

## Statut par usage

| Usage | Statut |
|---|---|
| Demonstration | adapte |
| Pilote B2B cadre | adapte avec configuration securisee |
| Production limitee | a completer |
| Production enterprise | non suffisant seul |

## Non confirme dans le depot analyse

- backend Terraform distant;
- restore backup teste;
- WAF/API Management;
- CI/CD complet;
- HA PostgreSQL enterprise;
- image scanning systematique.
