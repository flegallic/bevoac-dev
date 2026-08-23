'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function collectTests(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...collectTests(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      output.push(fullPath);
    }
  }
  return output.sort();
}

const testsRoot = path.resolve(__dirname, '..', 'tests');
const tests = collectTests(testsRoot);
if (tests.length === 0) {
  console.error(`No test files found under ${testsRoot}`);
  process.exit(2);
}

const result = spawnSync(process.execPath, ['--test', ...tests], {
  stdio: 'inherit',
  env: process.env
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
