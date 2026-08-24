#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

REPORT="${V620_LOCAL_VALIDATION_REPORT:-$ROOT/artifacts/v6.2.0-local-validation.txt}"
mkdir -p "$(dirname "$REPORT")"
exec > >(tee "$REPORT") 2>&1

NODE_VERSION="$(node --version 2>/dev/null || echo unavailable)"

echo "MODE=LOCAL_READ_ONLY_VALIDATION"
echo "AZURE_COMMANDS=none"
echo "TERRAFORM_APPLY=none"
echo "POSTGRESQL_MUTATION=none"
echo "NODE_VERSION=$NODE_VERSION"
echo "REPOSITORY=$ROOT"

./validate_release.sh --structure-only
bash scripts/ci/source-security-gate.sh
node scripts/ci/dependency-security-gate.js
python3 scripts/ci/relative-import-gate.py --repo "$ROOT"
bash bevoac-iac-enterprise/scripts/static-hardening-check.sh
python3 scripts/ci/terraform-static-reference-check.py --repo "$ROOT"

if [[ -d .git ]]; then
  git diff --check
fi

js_count=0
while IFS= read -r -d '' file; do
  js_count=$((js_count + 1))
  node --check "$file" >/dev/null
done < <(
  find . -type f -name '*.js' \
    -not -path './.git/*' \
    -not -path '*/node_modules/*' \
    -not -path './artifacts/*' \
    -not -path '*/.next/*' \
    -print0
)

sh_count=0
while IFS= read -r -d '' file; do
  sh_count=$((sh_count + 1))
  bash -n "$file"
done < <(
  find . -type f -name '*.sh' \
    -not -path './.git/*' \
    -not -path './artifacts/*' \
    -print0
)

python3 - <<'PY'
import ast
import json
from pathlib import Path

ignored = {'.git', 'node_modules', '.terraform', '__pycache__', 'artifacts', '.next', 'coverage'}
json_count = 0
json_schema_count = 0
python_count = 0
try:
    from jsonschema.validators import validator_for
except ImportError:
    validator_for = None
for path in Path('.').rglob('*'):
    if not path.is_file() or any(part in ignored for part in path.parts):
        continue
    if path.suffix == '.json':
        document = json.loads(path.read_text(encoding='utf-8'))
        json_count += 1
        schema_keywords = {'type', '$defs', 'properties', 'allOf', 'oneOf', 'anyOf'}
        if (validator_for is not None and isinstance(document, dict) and '$schema' in document
                and schema_keywords.intersection(document)):
            validator_for(document).check_schema(document)
            json_schema_count += 1
    elif path.suffix == '.py':
        ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
        python_count += 1
print(f'JSON_PARSE_COUNT={json_count}')
print(f'JSON_SCHEMA_META_VALIDATION_COUNT={json_schema_count}')
print(f'JSON_SCHEMA_META_VALIDATION_EXECUTED={str(validator_for is not None).lower()}')
print(f'PYTHON_SYNTAX_COUNT={python_count}')
PY

python3 - <<'PY'
from pathlib import Path
try:
    import yaml
except ImportError:
    print('YAML_PARSE_EXECUTED=false')
else:
    ignored = {'.git', 'node_modules', '.terraform', 'artifacts', '.next', 'coverage'}
    count = 0
    for path in Path('.').rglob('*'):
        if not path.is_file() or any(part in ignored for part in path.parts):
            continue
        if path.suffix.lower() not in {'.yml', '.yaml'}:
            continue
        yaml.safe_load(path.read_text(encoding='utf-8'))
        count += 1
    print(f'YAML_PARSE_COUNT={count}')
    print('YAML_PARSE_EXECUTED=true')
PY

# Parse TypeScript/TSX without resolving imports. This catches syntax errors in
# the demo frontend even when npm dependencies are unavailable locally.
TS_NODE_PATH="${NODE_PATH:-}"
if command -v npm >/dev/null 2>&1; then
  GLOBAL_NODE_MODULES="$(npm root -g 2>/dev/null || true)"
  if [[ -n "$GLOBAL_NODE_MODULES" ]]; then
    TS_NODE_PATH="${TS_NODE_PATH:+$TS_NODE_PATH:}$GLOBAL_NODE_MODULES"
  fi
fi
if NODE_PATH="$TS_NODE_PATH" node -e "require.resolve('typescript')" >/dev/null 2>&1; then
  NODE_PATH="$TS_NODE_PATH" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ignored = new Set(['.git', 'node_modules', '.terraform', 'artifacts', '.next', 'coverage']);
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const current = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(current);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(current);
  }
}
walk(process.cwd());
let diagnostics = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
    },
  });
  for (const diagnostic of result.diagnostics || []) {
    if (diagnostic.category === ts.DiagnosticCategory.Error) {
      diagnostics.push(`${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
    }
  }
}
if (diagnostics.length) {
  console.error(diagnostics.join('\n'));
  process.exit(1);
}
console.log(`TYPESCRIPT_PARSE_COUNT=${files.length}`);
console.log('TYPESCRIPT_PARSE_EXECUTED=true');
NODE
else
  echo "TYPESCRIPT_PARSE_EXECUTED=false"
  echo "TYPESCRIPT_PARSE_REASON=typescript_module_unavailable"
fi

PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s bevoac-iac-enterprise/tests -p 'test_*.py' -v

API_TESTS=(
  bevoac-api-enterprise/tests/security/admin-billing-schema-v620.test.js
  bevoac-api-enterprise/tests/security/admin-role-v620.test.js
  bevoac-api-enterprise/tests/security/apim-boundary-v620.test.js
  bevoac-api-enterprise/tests/security/config-fail-closed-v620.test.js
  bevoac-api-enterprise/tests/security/db-context-v620.test.js
  bevoac-api-enterprise/tests/security/http-schema-v620.test.js
  bevoac-api-enterprise/tests/security/idempotency-fingerprint-v620.test.js
  bevoac-api-enterprise/tests/security/module-catalog-v620.test.js
  bevoac-api-enterprise/tests/security/onboarding-http-schema-v620.test.js
  bevoac-api-enterprise/tests/security/onboarding-state-v620.test.js
  bevoac-api-enterprise/tests/security/runtime-separation.test.js
  bevoac-api-enterprise/tests/security/security-headers-v620.test.js
  bevoac-api-enterprise/tests/security/dependency-refresh-r2-1.test.js
)

WORKER_TESTS=(
  bevoac-worker-enterprise/tests/config-fail-closed-v620.test.js
  bevoac-worker-enterprise/tests/db-context-v620.test.js
  bevoac-worker-enterprise/tests/message-processor-retry-v620.test.js
  bevoac-worker-enterprise/tests/module-catalog-preflight-v620.test.js
  bevoac-worker-enterprise/tests/module-timeout-v620.test.js
  bevoac-worker-enterprise/tests/provider-boundary-runtime.test.js
  bevoac-worker-enterprise/tests/provider-registry.test.js
  bevoac-worker-enterprise/tests/resource-graph-pagination-v620.test.js
  bevoac-worker-enterprise/tests/result-sanitizer-v620.test.js
  bevoac-worker-enterprise/tests/scan-store-ownership-v620.test.js
  bevoac-worker-enterprise/tests/status-semantics-v620.test.js
  bevoac-worker-enterprise/tests/tags-resource-graph-pagination-v620.test.js
  bevoac-worker-enterprise/tests/worker-errors-v620.test.js
  bevoac-worker-enterprise/tests/resource-graph-rest-client-r2-1.test.js
  bevoac-worker-enterprise/tests/security/dependency-refresh-r2-1.test.js
)

node --test "${API_TESTS[@]}" "${WORKER_TESTS[@]}"


SBOM_DIR="$ROOT/artifacts/sbom"
mkdir -p "$SBOM_DIR"
node scripts/ci/generate-cyclonedx-from-lock.js --project-dir bevoac-api-enterprise --output "$SBOM_DIR/api.cdx.json" --omit-dev
node scripts/ci/generate-cyclonedx-from-lock.js --project-dir bevoac-worker-enterprise --output "$SBOM_DIR/worker.cdx.json" --omit-dev
node scripts/ci/validate-cyclonedx-sbom.js "$SBOM_DIR/api.cdx.json" "$SBOM_DIR/worker.cdx.json"

echo "JS_SYNTAX_COUNT=$js_count"
echo "SHELL_SYNTAX_COUNT=$sh_count"
echo "LOCAL_STATIC_VALIDATION_OK=true"
echo "FULL_NODE24_DEPENDENCY_TESTS_EXECUTED=false"
echo "FRONTEND_DEPENDENCY_BUILD_EXECUTED=false"
echo "TERRAFORM_VALIDATE_EXECUTED=false"
echo "POSTGRESQL_INTEGRATION_EXECUTED=false"
echo "LIVE_AZURE_SMOKE_EXECUTED=false"
echo "REPORT=$REPORT"
