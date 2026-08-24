# Déploiement Azure — DEMO-ONLY

Ce répertoire ne déploie **pas** un portail client de production. Le frontend V6.2.0 affiche uniquement des données de démonstration statiques et ne collecte aucune clé API client.

Le script est bloqué par défaut. Pour un environnement de démonstration explicitement approuvé :

```bash
cp deploy/prod.env.example deploy/prod.env
CONFIRM_DEMO_ONLY_DEPLOY=YES ./deploy/deploy-azure.sh
```

Le déploiement doit utiliser un tag immuable lié au commit. `latest` est interdit. L’image et son digest sont affichés en fin d’exécution.

Le portail client authentifié, les sessions utilisateur et le lancement réel de scans sont hors périmètre de ce frontend.
