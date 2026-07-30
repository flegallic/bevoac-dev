# Versioning et statuts de preuve

## Application vs documentation

- application cible de ce package : `6.1.3-production-ready` ;
- baseline documentaire canonique : `V6.1.2-R3` ;
- guide de déploiement : `V6.1.3` ;
- contrat public `/v1` et contrat actif `scan.requested` : inchangés par cette release ;
- Azure reste le seul provider runtime activé ; AWS et GCP restent fail-closed.

La révision documentaire R3 décrit le modèle de sécurité issu de V6.1.2. La version applicative V6.1.3 identifie les images contenant le câblage runtime, la CI, les tests et l’IaC de déploiement de ce modèle.

## Statuts

- **IMPLÉMENTÉ DANS LE CODE** ;
- **VALIDÉ SUR POSTGRESQL JETABLE** ;
- **POUSSÉ SUR GITHUB** ;
- **À INDUSTRIALISER EN CI** ;
- **À VALIDER EN STAGING** ;
- **À DÉPLOYER EN PRODUCTION**.

Un statut local ou CI ne doit jamais être présenté comme une preuve d’état Azure. Le statut « enterprise-ready production baseline » n’est accordé qu’après les gates live décrites dans `VALIDATION_MATRIX.md` et le guide de déploiement V6.1.3.
