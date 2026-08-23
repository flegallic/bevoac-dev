#!/usr/bin/env node
const required = [
  '@azure/identity',
  '@azure/service-bus',
  '@azure/arm-storage',
  '@azure/arm-network',
  '@azure/arm-compute',
  '@microsoft/microsoft-graph-client',
  'ajv',
  'pg',
  'pino'
];

const missing = [];
for (const dep of required) {
  try { require.resolve(dep); } catch (_) { missing.push(dep); }
}

if (missing.length) {
  console.error(`[ERROR] Missing worker runtime dependencies: ${missing.join(', ')}`);
  console.error('Run npm ci with Node.js 24 before starting the worker.');
  process.exit(1);
}
console.log(`Worker runtime dependency check OK (${required.length} modules).`);
