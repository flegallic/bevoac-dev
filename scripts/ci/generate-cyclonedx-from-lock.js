#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function usage() {
  console.error('Usage: generate-cyclonedx-from-lock.js --project-dir <dir> --output <file> [--omit-dev]');
  process.exit(2);
}

function parseArgs(argv) {
  const result = { omitDev: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-dir') result.projectDir = argv[++i];
    else if (arg === '--output') result.output = argv[++i];
    else if (arg === '--omit-dev') result.omitDev = true;
    else usage();
  }
  if (!result.projectDir || !result.output) usage();
  return result;
}

function candidatePaths(packageKey, dependencyName) {
  const bases = packageKey ? [packageKey] : [''];
  let current = packageKey;
  while (current && current.includes('/node_modules/')) {
    current = current.slice(0, current.lastIndexOf('/node_modules/'));
    bases.push(current);
  }
  if (!bases.includes('')) bases.push('');
  return [...new Set(bases.map((base) => base
    ? `${base}/node_modules/${dependencyName}`
    : `node_modules/${dependencyName}`))];
}

function resolveDependency(packages, packageKey, dependencyName) {
  return candidatePaths(packageKey, dependencyName).find((candidate) => packages[candidate]) || null;
}

function dependencyGroups(record, { root = false, omitDev = false } = {}) {
  const groups = [record.dependencies || {}, record.optionalDependencies || {}];
  if (root && !omitDev) groups.push(record.devDependencies || {});
  return groups;
}

function reachablePackages(lock, omitDev) {
  const packages = lock.packages || {};
  if (!packages['']) throw new Error('package-lock.json has no root package record.');
  const reachable = new Set(['']);
  const queue = [''];
  while (queue.length) {
    const key = queue.shift();
    const record = packages[key];
    for (const group of dependencyGroups(record, { root: key === '', omitDev })) {
      for (const name of Object.keys(group)) {
        const resolved = resolveDependency(packages, key, name);
        if (!resolved) {
          throw new Error(`Unresolved package-lock dependency ${name} from ${key || '<root>'}.`);
        }
        if (!reachable.has(resolved)) {
          reachable.add(resolved);
          queue.push(resolved);
        }
      }
    }
    for (const name of Object.keys(record.peerDependencies || {})) {
      const resolved = resolveDependency(packages, key, name);
      if (resolved && !reachable.has(resolved)) {
        reachable.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return reachable;
}

function packageName(packageKey) {
  const marker = 'node_modules/';
  const index = packageKey.lastIndexOf(marker);
  return packageKey.slice(index + marker.length);
}

function purl(name, version) {
  if (name.startsWith('@')) {
    const slash = name.indexOf('/');
    const scope = name.slice(0, slash);
    const local = name.slice(slash + 1);
    return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(local)}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function bomRef(packageKey, record) {
  const digest = crypto.createHash('sha256').update(`${packageKey}\0${record.version}`).digest('hex');
  return `urn:bevoac:npm:${digest}`;
}

function deterministicUuid(lockText) {
  const bytes = crypto.createHash('sha256').update(lockText).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sriHashes(integrity) {
  if (!integrity || typeof integrity !== 'string') return undefined;
  const algorithms = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };
  const hashes = [];
  for (const token of integrity.split(/\s+/)) {
    const match = token.match(/^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/);
    if (!match) continue;
    try {
      hashes.push({ alg: algorithms[match[1]], content: Buffer.from(match[2], 'base64').toString('hex') });
    } catch (_) {}
  }
  return hashes.length ? hashes : undefined;
}

function componentFor(packageKey, record) {
  const name = packageName(packageKey);
  const component = {
    type: 'library',
    'bom-ref': bomRef(packageKey, record),
    name,
    version: String(record.version),
    purl: purl(name, String(record.version)),
    properties: [
      { name: 'bevoac:npm:lock-path', value: packageKey },
      { name: 'bevoac:npm:dev', value: String(Boolean(record.dev)) },
      { name: 'bevoac:npm:optional', value: String(Boolean(record.optional)) }
    ]
  };
  const hashes = sriHashes(record.integrity);
  if (hashes) component.hashes = hashes;
  if (typeof record.license === 'string' && record.license.trim()) {
    component.licenses = [{ license: { id: record.license.trim() } }];
  }
  if (typeof record.resolved === 'string' && /^https:\/\//.test(record.resolved)) {
    component.externalReferences = [{ type: 'distribution', url: record.resolved }];
  }
  return component;
}

function generate(projectDir, output, omitDev) {
  const packageFile = path.resolve(projectDir, 'package.json');
  const lockFile = path.resolve(projectDir, 'package-lock.json');
  const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const lockText = fs.readFileSync(lockFile, 'utf8');
  const lock = JSON.parse(lockText);
  if (lock.lockfileVersion !== 3) throw new Error(`Unsupported lockfileVersion ${lock.lockfileVersion}; expected 3.`);
  const reachable = reachablePackages(lock, omitDev);
  const packageKeys = [...reachable].filter(Boolean).sort();
  const refs = new Map(packageKeys.map((key) => [key, bomRef(key, lock.packages[key])]));
  const rootRef = `pkg:npm/${encodeURIComponent(packageJson.name)}@${encodeURIComponent(packageJson.version)}`;
  const components = packageKeys.map((key) => componentFor(key, lock.packages[key]));

  const dependencies = [];
  for (const key of ['', ...packageKeys]) {
    const record = lock.packages[key];
    const dependsOn = new Set();
    for (const group of dependencyGroups(record, { root: key === '', omitDev })) {
      for (const name of Object.keys(group)) {
        const resolved = resolveDependency(lock.packages, key, name);
        if (resolved && reachable.has(resolved)) dependsOn.add(refs.get(resolved));
      }
    }
    for (const name of Object.keys(record.peerDependencies || {})) {
      const resolved = resolveDependency(lock.packages, key, name);
      if (resolved && reachable.has(resolved)) dependsOn.add(refs.get(resolved));
    }
    dependencies.push({ ref: key === '' ? rootRef : refs.get(key), dependsOn: [...dependsOn].sort() });
  }

  const bom = {
    $schema: 'https://cyclonedx.org/schema/bom-1.6.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${deterministicUuid(lockText)}`,
    version: 1,
    metadata: {
      tools: {
        components: [{
          type: 'application',
          name: 'bevoac-lockfile-sbom',
          version: '1.0.0'
        }]
      },
      component: {
        type: 'application',
        'bom-ref': rootRef,
        name: packageJson.name,
        version: packageJson.version,
        purl: purl(packageJson.name, packageJson.version)
      },
      properties: [
        { name: 'bevoac:sbom:source', value: 'npm-package-lock-v3' },
        { name: 'bevoac:sbom:omit-dev', value: String(Boolean(omitDev)) }
      ]
    },
    components,
    dependencies
  };

  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(bom, null, 2)}\n`);
  console.log(`SBOM_PROJECT=${packageJson.name}`);
  console.log(`SBOM_COMPONENTS=${components.length}`);
  console.log(`SBOM_OMIT_DEV=${omitDev}`);
  console.log(`SBOM_OUTPUT=${path.resolve(output)}`);
  console.log('CYCLONEDX_LOCKFILE_SBOM_OK=true');
}

const args = parseArgs(process.argv.slice(2));
try {
  generate(path.resolve(args.projectDir), path.resolve(args.output), args.omitDev);
} catch (error) {
  console.error(`CYCLONEDX_LOCKFILE_SBOM_ERROR=${error.message}`);
  process.exit(1);
}
