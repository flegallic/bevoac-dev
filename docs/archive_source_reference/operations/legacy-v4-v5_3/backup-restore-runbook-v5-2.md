# Backup et restore PostgreSQL V5.2

## Statut

Backup/restore teste: Non confirme dans le depot analyse.

## Objectif avant pilote avance

Prouver qu'un dump et une restauration fonctionnent sur une base de test.

## Backup logique

```bash
export BACKUP_FILE="bevoac-pg-$(date +%Y%m%d%H%M).dump"
PGPASSWORD="$PG_PASSWORD" pg_dump -Fc -h "$PG_HOST" -U "$PG_USER" -d "$PG_DATABASE" -f "$BACKUP_FILE"
ls -lh "$BACKUP_FILE"
```

## Restore test

Restaurer dans une base de test, jamais par-dessus la base pilote sans procedure approuvee.

```bash
createdb bevoac_restore_test
PGPASSWORD="$PG_PASSWORD" pg_restore -h "$PG_HOST" -U "$PG_USER" -d bevoac_restore_test "$BACKUP_FILE"
```

## Validation post-restore

```sql
SELECT COUNT(*) FROM tenants;
SELECT COUNT(*) FROM scans;
SELECT COUNT(*) FROM scan_results;
SELECT COUNT(*) FROM outbox_events;
SELECT COUNT(*) FROM billing_usage_ledger;
```

## Critere Go

- dump non vide;
- restore dans base test OK;
- tables critiques lisibles;
- temps de restauration documente.
