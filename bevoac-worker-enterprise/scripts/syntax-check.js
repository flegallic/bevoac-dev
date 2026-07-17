const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const roots = ['src', 'scanners', 'scripts'].map((item) => path.join(__dirname, '..', item));
function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}
const files = roots.flatMap((root) => walk(root));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax check OK (${files.length} files).`);
