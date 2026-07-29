# Decision record - RLS PostgreSQL V5.2

## Statut

RLS PostgreSQL: Non confirme dans le depot analyse.

## Contexte

Bevoac utilise aujourd'hui une isolation logique applicative: toutes les lectures critiques filtrent par `tenant_id`. Pour un pilote, cela est acceptable si les tests d'acces croise sont verts. Pour une production enterprise, une protection supplementaire en base doit etre etudiee.

## Options

### Option A - Continuer avec isolation applicative

Avantages: simple, rapide.  
Limites: un bug SQL peut exposer des donnees cross-tenant.

### Option B - RLS PostgreSQL

Avantages: defense-in-depth.  
Limites: complexite de session variables, migrations, tests et jobs.

### Option C - Base/schema par tenant

Avantages: isolation forte.  
Limites: cout operationnel et migration plus eleves.

## Decision temporaire pilote

Conserver isolation applicative avec tests cross-tenant obligatoires.

## Decision avant production enterprise

RLS ou equivalent doit etre decide et teste.
