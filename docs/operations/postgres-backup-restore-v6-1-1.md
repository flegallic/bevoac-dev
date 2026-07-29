# Bevoac V6.1.1 - PostgreSQL backup and restore drill

## Objectif

Prouver qu'un crash ou incident PostgreSQL peut etre traite par restauration Azure Flexible Server.

## Verification backup

```bash
cd bevoac-iac-enterprise
bash scripts/postgres-backup-status.sh
```

## Restore drill

```bash
export RESTORE_SERVER_NAME="psql-bevoac-restore-$(date +%Y%m%d%H%M)"
export RESTORE_TIME_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
bash scripts/postgres-restore-drill.sh
```

## Sanity SQL apres restore

```sql
SELECT version, name, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 10;
SELECT COUNT(*) FROM tenants;
SELECT COUNT(*) FROM scans;
SELECT COUNT(*) FROM scan_results;
```

## Nettoyage

```bash
az postgres flexible-server delete --resource-group "$RESOURCE_GROUP" --name "$RESTORE_SERVER_NAME" --yes
```
