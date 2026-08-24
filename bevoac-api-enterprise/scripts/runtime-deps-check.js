#!/usr/bin/env node
const required = [
  'fastify',
  '@fastify/cors',
  '@fastify/rate-limit',
  '@fastify/swagger',
  'pg',
  '@azure/service-bus',
  '@azure/identity',
  'jose',
  'pdfmake'
];

const missing = [];
for (const dep of required) {
  try { require.resolve(dep); } catch (error) { missing.push(dep); }
}

if (missing.length) {
  console.error(`[ERROR] Missing runtime dependencies: ${missing.join(', ')}`);
  console.error('Run npm install with Node 20 LTS before starting or migrating the API.');
  process.exit(1);
}
console.log(`Runtime dependency check OK (${required.length} modules).`);
