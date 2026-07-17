#!/usr/bin/env node
'use strict';

console.error(
  'BLOCKED: this legacy RLS migration trusts ' +
  'the mutable app.service_context setting and ' +
  'must never be applied. Use ' +
  'npm run migrate-db:runtime-role-rls instead.'
);

process.exitCode = 1;
