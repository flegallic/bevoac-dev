# Isolation tenant V6.1.2

## Défenses en profondeur

1. tenant dérivé de la clé API ;
2. `tenantId/customerId` refusé dans le body ;
3. allowlists web/Azure ;
4. requêtes avec identifiants tenant ;
5. login PostgreSQL réel ;
6. `app.current_tenant_id` borné ;
7. `FORCE RLS` ;
8. contraintes et triggers de cohérence ;
9. denial tests.

## Résultats validés

- sans contexte tenant : 0 ligne visible pour API/worker ;
- tenant A : données A visibles ;
- tenant B : 0 ligne visible depuis A ;
- insert cross-tenant refusé ;
- élévation vers `bevoacadmin` refusée ;
- accès direct aux tables sensibles refusé.
