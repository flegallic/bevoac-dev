# Pricing et cadrage pilote Bevoac V5.1

## 1. Objectif

Document interne pour cadrer une offre pilote. Les prix peuvent evoluer et ne constituent pas une grille contractuelle finale.

## 2. Modele courant

| Plan | Usage cible | Quota indicatif | Limite ressources infra |
|---|---|---|---|
| free | demo / test | 30 unites / mois | 10 ressources |
| standard | PME / pilote simple | 2500 unites / mois | 500 ressources |
| business | multi-sites / integrateur | 10000 unites / mois | 2500 ressources |
| payg | audit ponctuel | a la requete | selon configuration |

## 3. Unite de billing

Regle technique actuelle:

- scan `web` ou `entra`: 1 unite;
- scan `infra` ou `full`: nombre de subscriptions ciblees, minimum 1.

## 4. Regle documentaire

Ne pas promettre une facturation definitive tant que le modele billing post-echec n'est pas verrouille.

Backlog P1:

- clarifier si un scan `FAILED` est facture, credite ou neutralise;
- ajouter un etat `reserved/consumed/refunded` ou un evenement de credit;
- documenter la regle dans le contrat pilote.

## 5. Positionnement pilote

Un pilote doit mesurer:

- onboarding Microsoft;
- scan web;
- scan infra;
- generation JSON;
- generation PDF;
- correction et relance apres remediation;
- stabilite worker;
- DLQ zero;
- comprehension du rapport par l'equipe technique.
