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
    if (!Array.isArray(descriptor.profiles) || descriptor.profiles.length === 0) {
      throw new Error(`Module ${name} must declare at least one profile.`);
    }
    if (!['web', 'tenant', 'subscription'].includes(descriptor.scope)) {
      throw new Error(`Module ${name} has an invalid scope.`);
    }
  }
  return document;
}

validateCatalog();

const MODULE_DESCRIPTORS = Object.freeze(catalog.modules.map((entry) => Object.freeze({ ...entry })));
const MODULE_BY_NAME = new Map(MODULE_DESCRIPTORS.map((entry) => [entry.name, entry]));
const PROFILE_MODULES = Object.freeze(Object.fromEntries(
  ['web', 'entra', 'infra', 'full'].map((profile) => [
    profile,
    Object.freeze(MODULE_DESCRIPTORS.filter((entry) => entry.profiles.includes(profile)).map((entry) => entry.name))
  ])
));

function modulesForProfile(profile) {
  return PROFILE_MODULES[profile] ? [...PROFILE_MODULES[profile]] : [];
}

function modulesWithScope(scope) {
  return MODULE_DESCRIPTORS.filter((entry) => entry.scope === scope).map((entry) => entry.name);
}

function modulesRequiringPreflight() {
  return MODULE_DESCRIPTORS.filter((entry) => entry.resourcePreflight).map((entry) => entry.name);
}

module.exports = {
  MODULE_DESCRIPTORS,
  MODULE_BY_NAME,
  PROFILE_MODULES,
  modulesForProfile,
  modulesWithScope,
  modulesRequiringPreflight,
  validateCatalog,
};
