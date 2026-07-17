# bevoac-worker-enterprise - V5.1 Azure-first

Worker asynchrone Bevoac pour demonstration et pilote B2B cadre.

## Role

Le worker consomme `scan.requested`, valide le contrat V5.1, execute les modules web/Entra/Azure infra, stocke les resultats dans `scan_results` et finalise le statut du scan.

## Responsabilites

- valider le schema message;
- gerer les Service Bus sessions si activees;
- creer une tentative `scan_attempts`;
- passer le scan en `IN_PROGRESS`;
- compter les ressources infra;
- appliquer les limites de ressources;
- executer les modules;
- stocker resultats, resume, taille et hash;
- marquer `DONE` ou `FAILED`;
- dead-letter les messages invalides.

## Limites connues

- retries/backoff Azure/Graph a renforcer;
- timeouts a rendre plus cancellatifs;
- secret Microsoft cross-tenant encore necessaire en V5.1;
- tests automatises modules a completer.
