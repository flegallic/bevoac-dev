# Bevoac V6.1.1 - Backfill billing

Toujours executer `npm run backfill:billing:dry-run` avant `--apply`. Le but est de corriger les anciens scans `DONE / RESERVED` vers `DONE / CONSUMED` avec un evenement `scan_consumed`. Le dry-run final doit retourner `candidates=0`.
