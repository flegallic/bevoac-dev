## Modèle économique
- Starter Pack (one-shot pour installation client):
    - 990 € HT 
    - Onboarding, coffre-fort, 1er audit de référence, session avec ingénieur
    - onboarding, baseline, session ingénieur, livrable immédiat.
- free :
    - 0 € HT / mois
    - 30 unités de scan / mois incluses
    - démo
    - Limite ressources infra : 10
- Standard : 
    - 89 € HT / mois
    - 2 500 unités de scan / mois incluses
    - rythme mensuel / hebdo light
    - Limite ressources infra : 500
- Business
    - 149 € HT / mois
    - 10 000 unités de scan / mois incluses
    - rythme hebdo / multi-comptes / multi-clients
    - Limite ressources infra : 2500
- Pay-as-you-go
    - cadre : POC, audits ponctuels (M&A, incident, audit client), dépassement.
    - 0,10 € / unité en standard
    - 0,08 € / unité en business
    - Dépassement de quota, à la requête

- **Dans le code revu ici, une unité de billing n’est pas toujours strictement “1 requête = 1 unité”** :
  - scan `web` ou `entra` = 1 unité
  - scan `infra` ou `full` = nombre de subscriptions ciblées (minimum 1)

## Proposition de valeur B2B (ce que vous dites à un prospect)
- Pour une PME de 50 personnes sous Azure :
> Pour 89 €/mois — moins qu'un abonnement logiciel standard — vous savez en permanence si votre cloud est bien configuré. Pas de consultant à mobiliser, pas d'outil à déployer. Votre équipe reçoit un rapport clair, priorisé, avec les actions correctives. Et vos données restent hébergées en France dans l’architecture revue.

- Pour un intégrateur/revendeur :
> bevoac est une API blanche que vous pouvez intégrer directement dans votre offre de services managés. Proposez des audits de sécurité cloud à vos clients PME sans investir dans la R\&D ni la conformité. Votre logo, notre moteur.


## Valeur concrète PME/ETI (ce qu’ils “achètent” vraiment)
- Time-to-value immédiat : connexion → rapport exploitable, sans projet.
- Réduction de charge : pas besoin d’un expert CSPM pour trier et reformuler.
- Priorisation actionnable : quick wins + plan d’action synthétique pour lecture DSI/RSSI.
- Conformité : résultats JSON structurés + PDF exécutif, avec trajectoire d’enrichissement vers davantage de preuves.
- Multi-cloud simple : trajectoire produit vers un standard de sortie homogène, même si la version revue ici est aujourd’hui centrée sur Azure.
- Souveraineté : moins de friction achat (secteurs sensibles / exigences clients).

## L'avantage concurrentiel
La norme sur le marché de la sécurité cloud (Wiz, Orca, Microsoft Defender) est de facturer "au workload" (à la VM, au conteneur, à la base de données). Cela crée une énorme friction à l'achat pour une PME ou un revendeur, car la facture cloud fluctue tous les mois selon l'usage.

En décorrélant la facturation du nombre d'instances :
- on supprime la friction d'inventaire : le prospect n'a pas besoin de compter ses ressources avant de s'abonner ; il comprend le coût par unité de scan et par quota mensuel.
- on rassure le DSI/RSSI : le budget est beaucoup plus prévisible et répétable, ce qui correspond à la promesse de “coût prévisible”.
- on facilite la vie des partenaires MSSP : un intégrateur peut packager la solution à un prix fixe pour ses propres clients sans craindre qu'une hausse du nombre de ressources à auditer fasse exploser la facture à l'actif.

## Addendum V2 - quotas ressources et blocage des plans

- Les plans **standard** et **business** restent limites par quota mensuel de scans. Lorsqu'un client atteint son quota, l'API bloque la demande avec `MONTHLY_SCAN_QUOTA_EXCEEDED` et ne bascule pas en PAYG.
- Une limite de ressources est ajoutee pour les scans infra : `free = 10 ressources`, `standard = 500 ressources`, `business = 2500 ressources`.
- Le worker realise un preflight Azure Resource Graph avant les modules infra. Si le nombre de ressources depasse la limite du plan, le scan est marque `FAILED` avec `RESOURCE_LIMIT_EXCEEDED` sans lancer les controles couteux.
- La route client `GET /v1/billing/current-month/scans` expose le detail des scans du mois courant.
