# PostgreSQL Backup et Restore Drill V6.1.2

## Objectif

Prouver un RPO/RTO mesuré. Le statut « backup activé » ne remplace pas un exercice de restauration.

## Procédure

1. relever la politique de backup et la fenêtre de rétention ;
2. créer un serveur restauré isolé ;
3. vérifier migrations, rôles, tables, contraintes et données critiques ;
4. exécuter des requêtes de lecture sans exposer de données client ;
5. mesurer durée et écarts ;
6. détruire le serveur restauré après validation ;
7. archiver la preuve.

## NO-GO enterprise

Aucun claim de reprise enterprise sans restore drill réussi et approuvé.
