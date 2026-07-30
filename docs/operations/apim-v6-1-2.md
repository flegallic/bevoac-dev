# APIM V6.1.2 - exposition B2B

## Rôle

APIM est le point d'entrée client recommandé. Il fournit URL stable, subscription key, quotas, rate limit, corrélation et journalisation edge. L'API key Bevoac reste obligatoire.

## Modes

| Mode | Headers client | Usage |
|---|---|---|
| Double authentification | `Ocp-Apim-Subscription-Key` + `Authorization: Bearer` | B2B standard |
| Bevoac-only | `Authorization: Bearer` | exception explicitement documentée |

## Cible

- chemin client via APIM ;
- accès direct Container Apps restreint ou break-glass ;
- aucune route admin sur l'API publique dans la cible séparée ;
- aucun secret client dans les policies.

## Preuves

- 401 sans subscription key ;
- 401 sans API key Bevoac ;
- 200 avec double authentification valide ;
- 413 au-delà de la taille autorisée ;
- corrélation propagée ;
- quota/rate limit observables.
