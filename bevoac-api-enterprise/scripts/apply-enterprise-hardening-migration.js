#!/usr/bin/env node
'use strict';

console.error(
  'BLOCKED: the enterprise-hardening baseline is part of the standard ordered ' +
  'migration set. Use npm run migrate-db; do not apply this migration separately.'
);
process.exitCode = 1;
