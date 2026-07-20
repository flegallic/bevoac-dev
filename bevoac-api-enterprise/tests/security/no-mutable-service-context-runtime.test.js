'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiRoot = path.resolve(__dirname, '../..');
const repositoryRoot = path.resolve(apiRoot, '..');
const workerRoot = path.join(
  repositoryRoot,
  'bevoac-worker-enterprise'
);

function listJavaScriptFiles(root) {
  const files = [];

  for (const entry of fs.readdirSync(root, {
    withFileTypes: true
  })) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...listJavaScriptFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.js')
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

test(
  'runtime source contains no mutable app.service_context',
  () => {
    const runtimeFiles = [
      ...listJavaScriptFiles(path.join(apiRoot, 'src')),
      ...listJavaScriptFiles(path.join(workerRoot, 'src'))
    ];

    const forbiddenPatterns = [
      /app\.service_context/,
      /\bSERVICE_CONTEXTS\b/,
      /\bassertServiceContext\b/,
      /\bsetServiceContext\b/,
      /\bwithServiceSession\b/,
      /\bwithServiceTransaction\b/,
      /\bbevoac_(?:auth|api|worker|outbox|retention|admin)_service\b/
    ];

    const violations = [];

    for (const file of runtimeFiles) {
      const source = fs.readFileSync(file, 'utf8');

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(source)) {
          violations.push(
            `${path.relative(repositoryRoot, file)}: ${pattern}`
          );
        }
      }
    }

    assert.deepEqual(violations, []);
  }
);

test(
  'legacy enterprise tenant isolation launcher is removed',
  () => {
    const legacyScript = path.join(
      apiRoot,
      'scripts',
      'check-tenant-isolation-enterprise.js'
    );

    assert.equal(fs.existsSync(legacyScript), false);

    const packageJson = JSON.parse(
      fs.readFileSync(
        path.join(apiRoot, 'package.json'),
        'utf8'
      )
    );

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        packageJson.scripts || {},
        'check:tenant-isolation:enterprise'
      ),
      false
    );
  }
);

test(
  'database context libraries expose no service-context helpers',
  () => {
    const files = [
      path.join(apiRoot, 'src', 'lib', 'db-context.js'),
      path.join(workerRoot, 'src', 'lib', 'db-context.js')
    ];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');

      assert.doesNotMatch(source, /app\.service_context/);
      assert.doesNotMatch(source, /\bSERVICE_CONTEXTS\b/);
      assert.doesNotMatch(source, /\bassertServiceContext\b/);
      assert.doesNotMatch(source, /\bsetServiceContext\b/);
      assert.doesNotMatch(source, /\bwithServiceSession\b/);
      assert.doesNotMatch(source, /\bwithServiceTransaction\b/);
    }
  }
);
