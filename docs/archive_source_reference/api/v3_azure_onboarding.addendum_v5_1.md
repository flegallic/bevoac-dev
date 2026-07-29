# Addendum V5.1 - utilisation des scopes pour les scans infra

En V5.1, les scans `infra` doivent s'appuyer sur les scopes Azure vérifiés du tenant Bevoac.

Payload recommandé si le tenant ne possède qu'un scope Azure actif :

```json
{
  "cloudProvider": "azure",
  "scanProfile": "infra",
  "azure": {}
}
```

Payload recommandé en ciblage explicite :

```json
{
  "cloudProvider": "azure",
  "scanProfile": "infra",
  "azure": {
    "microsoftTenantId": "<tenant Microsoft vérifié>",
    "subscriptions": ["<subscription vérifiée>"]
  }
}
```

`targetUrl` n'est pas requis pour un scan `infra`. Il reste pertinent pour les profils `web` et `full`.
