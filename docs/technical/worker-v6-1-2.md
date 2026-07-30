# Worker V6.1.2

## Responsabilités

- recevoir `scan.requested` ;
- valider le contrat ;
- acquérir une tentative idempotente ;
- appliquer le contexte tenant ;
- exécuter modules web/Entra/Azure avec timeouts et retry ;
- effectuer resource preflight ;
- stocker résultat, summary, hash et KPI ;
- finaliser billing ;
- compléter, abandonner ou dead-letter le message.

## Sécurité

- login DB `bevoac_worker` ;
- droit Service Bus Receiver ;
- aucune route HTTP ;
- aucune fonction d'authentification API key ;
- aucun accès aux tenants hors besoin ;
- refus cross-tenant par RLS.
