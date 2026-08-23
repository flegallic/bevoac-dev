'use strict';

const catalog = require('../../contracts/module-catalog.json');

function validateCatalog(document = catalog) {
  if (!document || document.schemaVersion !== '1.0' || !Array.isArray(document.modules)) {
    throw new Error('Invalid module catalog.');
  }
  const names = new Set();
  for (const descriptor of document.modules) {
    const name = String(descriptor?.name || '').trim().toLowerCase();
    if (!name || names.has(name)) throw new Error(`Invalid or duplicate module catalog entry: ${name || '<empty>'}`);
    names.add(name);
  }
  return document;
}

validateCatalog();

const MODULE_DESCRIPTORS = Object.freeze(catalog.modules.map((entry) => Object.freeze({ ...entry })));
const MODULE_BY_NAME = new Map(MODULE_DESCRIPTORS.map((entry) => [entry.name, entry]));
const PREFLIGHT_MODULES = Object.freeze(MODULE_DESCRIPTORS.filter((entry) => entry.resourcePreflight).map((entry) => entry.name));
const WORKER_REGISTRY_MODULES = Object.freeze(MODULE_DESCRIPTORS.filter((entry) => entry.workerRegistry).map((entry) => entry.name));

module.exports = {
  MODULE_DESCRIPTORS,
  MODULE_BY_NAME,
  PREFLIGHT_MODULES,
  WORKER_REGISTRY_MODULES,
  validateCatalog,
};
