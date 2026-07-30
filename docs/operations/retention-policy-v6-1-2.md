# Rétention V6.1.2

## Principes

- job séparé avec `bevoac_retention` ;
- suppression selon plan et politique contractuelle ;
- insertion dans `retention_audit_log` ;
- aucun droit outbox ou admin non nécessaire ;
- test Azure du job, pas seulement local.

## Durées documentées

Les durées contractuelles doivent être confirmées par le produit et les contrats. Les valeurs historiquement utilisées (free 30, standard 90, business/payg 180 jours) ne doivent être présentées comme garanties qu'après validation commerciale et RGPD.
