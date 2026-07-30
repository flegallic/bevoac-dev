#!/usr/bin/env node
'use strict';

console.error(
  'BLOCKED: init-db.production-hardening.js is a legacy partial schema launcher. ' +
  'For a new database use npm run init-db followed by npm run migrate-db, ' +
  'npm run migrate-db:secure-api-key-auth and npm run migrate-db:runtime-role-rls.'
);
process.exitCode = 1;
