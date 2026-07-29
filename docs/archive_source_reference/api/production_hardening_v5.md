# Bevoac Production Hardening V5.1

## 1. Positionnement

La V5.1 est un durcissement Azure-first. Elle ne prétend pas prouver AWS/GCP. Le périmètre vendu et exploitable dans cette version est : scan web externe, onboarding Microsoft, scan Entra, scan Azure infrastructure, résultats JSON structurés, rapport PDF finding/remediation/evidence, historique, quotas, billing et relance après remédiation.

## 2. Multi-tenant logique

Les invariants de sécurité sont :

- `tenant_id` dérivé exclusivement de l'API key ;
- rejet de `tenantId` et `customerId` dans les requêtes client ;
- allowlist web via `tenant_web_targets` ;
- allowlist Azure via `tenant_azure_scopes` ;
- résultats attachés à `tenant_id` ;
- GET filtrés par tenant ;
- worker idempotent par scan/tenant/attempt ;
- Service Bus session par tenant.

## 3. Idempotence API

`Idempotency-Key` est optionnelle.

- Si fournie par le client : elle protège contre les retries et double soumissions.
- Si absente : l'API génère une clé serveur, la stocke et la retourne.

L'objectif est de rendre l'API simple pour le client tout en conservant un mode robuste pour les intégrations critiques.

## 4. Quota et backpressure

Le quota mensuel est verrouillé par transaction PostgreSQL.

Le backpressure limite le nombre de scans actifs par tenant/plan afin qu'un tenant ne monopolise pas la plateforme.

Plans typiques : free = 1, standard = 3, business = 10, payg = 10 scans actifs.

## 5. Fair scheduling

Avec Service Bus sessions :

- `sessionId = tenantId` ;
- le worker accepte des sessions tenant ;
- les messages d'un même tenant sont séquentiels ;
- plusieurs tenants peuvent progresser en parallèle selon la capacité.

## 6. Contrat de message partagé

La version de contrat ne doit pas être dupliquée à la main.

Source recommandée :

```text
contracts/scan-message-version.json
```

Valeur :

```text
2026-05-06-production-hardening-v5
```

Une divergence API/worker provoque une DLQ `/version must be equal to constant`.

## 7. SSRF et sécurité réseau web

Les scanners web doivent appliquer HTTPS uniquement par défaut, blocage localhost, `.local`, `.internal`, résolution DNS obligatoire, blocage IP privées/réservées/link-local/multicast/metadata cloud, redirections limitées et revalidées, connexion épinglée à une IP publique validée, SNI conservé, fallback `HEAD -> GET` pour les headers si HEAD échoue, timeout par sous-module.

Cette garde doit être complétée par un contrôle egress réseau côté Container Apps/NAT/Firewall selon posture cible.

## 8. Résultats et PostgreSQL

Le résultat complet est stocké dans `scan_results`.

La table `scans` conserve statut, métadonnées, résumé, hash, taille, timestamps et tenant. Les gros résultats peuvent être compressés. Les portails doivent utiliser `includeResult=false` quand le JSON complet n'est pas nécessaire.

## 9. PDF

Le PDF est borné par taille JSON max, timeout, nombre de findings/evidence plafonné. Le JSON API reste la source exhaustive.

## 10. Admin enterprise

Production :

```env
ADMIN_AUTH_MODE=oidc
```

Le mode secret partagé est local/staging uniquement. Toute activation de `ALLOW_ADMIN_SHARED_SECRET_IN_PRODUCTION=true` doit être considérée comme une exception temporaire à tracer.

## 11. Private endpoints

La cible production est Key Vault public access disabled, PostgreSQL public access disabled, Terraform depuis VNet/VPN/runner privé, scripts DB depuis VNet/VPN/runner privé, secrets via Key Vault/Managed Identity.

## 12. DLQ

La DLQ doit être monitorée, alertée, inspectée, purgée ou rejouée sous contrôle. Les messages DLQ liés à un ancien contrat `/version` doivent être purgés après déploiement du worker corrigé, sauf besoin d'analyse forensic.

## 13. Critères de sortie production

| Domaine | Critère |
|---|---|
| API | auth API key, anti-cross-tenant, idempotence, quotas |
| Worker | idempotence, retries, module timeouts, DLQ |
| Azure | onboarding, scopes vérifiés, RBAC minimal |
| Données | `scan_results`, rétention, backup/restore |
| Réseau | private endpoints, egress maîtrisé |
| Admin | OIDC + roles |
| Charge | API, worker, Service Bus, PostgreSQL, PDF |
| Sécurité | pentest API/SSRF/auth, secret scanning, image scanning |
| Documentation | runbook, guide déploiement, Mermaid et procédures alignés |
