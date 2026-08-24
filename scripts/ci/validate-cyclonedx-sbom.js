#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: validate-cyclonedx-sbom.js <bom.json> [...]');
  process.exit(2);
}

let totalComponents = 0;
for (const file of files) {
  const bom = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.6' || bom.version !== 1) {
    throw new Error(`${file}: invalid CycloneDX envelope.`);
  }
  if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(bom.serialNumber || '')) {
    throw new Error(`${file}: invalid serialNumber.`);
  }
  const rootRef = bom.metadata?.component?.['bom-ref'];
  if (!rootRef) throw new Error(`${file}: missing metadata component bom-ref.`);
  const components = Array.isArray(bom.components) ? bom.components : [];
  const refs = new Set([rootRef]);
  for (const component of components) {
    if (!component?.['bom-ref'] || !component.name || !component.version || !component.purl) {
      throw new Error(`${file}: incomplete component.`);
    }
    if (refs.has(component['bom-ref'])) throw new Error(`${file}: duplicate bom-ref ${component['bom-ref']}.`);
    refs.add(component['bom-ref']);
  }
  const dependencyRefs = new Set();
  for (const dependency of bom.dependencies || []) {
    if (!refs.has(dependency.ref)) throw new Error(`${file}: unknown dependency ref ${dependency.ref}.`);
    if (dependencyRefs.has(dependency.ref)) throw new Error(`${file}: duplicate dependency ref ${dependency.ref}.`);
    dependencyRefs.add(dependency.ref);
    for (const child of dependency.dependsOn || []) {
      if (!refs.has(child)) throw new Error(`${file}: unknown dependsOn ref ${child}.`);
    }
  }
  if (!dependencyRefs.has(rootRef)) throw new Error(`${file}: root dependency graph entry missing.`);
  totalComponents += components.length;
  console.log(`CYCLONEDX_FILE_OK=${file}`);
  console.log(`CYCLONEDX_COMPONENTS_${file.replace(/[^A-Za-z0-9]/g, '_')}=${components.length}`);
}
console.log(`CYCLONEDX_TOTAL_COMPONENTS=${totalComponents}`);
console.log('CYCLONEDX_STRUCTURAL_VALIDATION_OK=true');
