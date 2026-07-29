## Tableau offre comparative
| Critère                                              | Wiz / Orca (CNAPP) | Microsoft et/ou AWS  | bevoac |
| Multi-cloud                                          | ✅                 | ✅ (Azure + AWS/GCP) | ⚠️ (Azure livré, trajectoire multi-cloud assumée) |
| Souveraineté FR (hébergement + données FR)           | ❌                 | ⚠️ (plutôt UE)       | ✅ |
| Single-tenant (instance dédiée / on-prem)            | ❌                 | ❌                   | ❌ |
| API-first (consommable / intégrable)                 | ⚠️                 | ⚠️                   | ✅ |
| Audit-ready ISO (contrôles + export preuves “audit”) | ⚠️                 | ⚠️                   | ⚠️ (JSON structuré + PDF exécutif aujourd’hui, enrichissement ISO détaillé en trajectoire produit) |
| Rapport RSSI/DSI-ready (synthèse + priorisation)     | ⚠️                 | ❌                   | ✅ |
| Prix “PME-friendly”                                  | ❌                 | ⚠️                   | ✅ |
| Connecteur sans clés (pas de credentials long-lived) | ❌                 | ✅ natif ou fédération| ⚠️ (pas de secret client stocké côté SaaS, mais secret applicatif Bevoac utilisé aujourd’hui pour l’audit Azure cross-tenant) |
| Pay-as-you-go (à la requête)                         | ❌                 | ❌                   | ✅ |

## Defender for Cloud fait du Rapport RSSI/DSI-ready ?
Il propose des rapports de conformité, oui. Bevoac se différencie aujourd’hui par sa simplicité d’intégration, son approche API-first, son billing exploitable et sa restitution synthétique. La vision multi-cloud reste pertinente dans la trajectoire produit, mais la version de code revue ici couvre aujourd’hui **web + Azure**.

## Et avec Nexir Protect ?
Si Nexir Protect vend une plateforme cyber étendue on-prem :
- bevoac = brique spécialisée “posture cloud / web” API-first, rapide à intégrer, livrable immédiat
- Nexir Protect = offre cyber large (assurance + monitoring + services)

Deux options stratégiques très cohérentes :
1) Positionnement frontal : L’audit posture cloud / web en minutes, prêt RSSI/DSI, souverain, sans projet. 
2) Positionnement partenaire : bevoac comme moteur CSPA dans une plateforme cyber étendue (revendeurs/MSSP/assureurs).
