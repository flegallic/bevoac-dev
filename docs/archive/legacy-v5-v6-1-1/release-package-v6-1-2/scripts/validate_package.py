#!/usr/bin/env python3
from __future__ import annotations
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ROOT / 'files'
REQUIRED = [
    'bevoac-api-enterprise/src/lib/db-context.js',
    'bevoac-api-enterprise/src/lib/findings-collector.js',
    'bevoac-api-enterprise/src/lib/api-scopes.js',
    'bevoac-api-enterprise/src/plugins/auth-api-key.js',
    'bevoac-api-enterprise/src/routes/scans.js',
    'bevoac-api-enterprise/src/routes/onboarding-azure.js',
    'bevoac-api-enterprise/src/services/scan-service.js',
    'bevoac-api-enterprise/src/services/result-store.js',
    'bevoac-api-enterprise/src/services/billing-service.js',
    'bevoac-worker-enterprise/src/services/scan-store.js',
    'bevoac-api-enterprise/migrations/202607090001_enterprise_hardening_baseline.sql',
    'bevoac-api-enterprise/migrations/optional/202607090002_enterprise_rls_runtime_roles.sql',
]

def main() -> int:
    missing = [p for p in REQUIRED if not (FILES / p).exists()]
    if missing:
        print('Missing files:', missing, file=sys.stderr)
        return 1
    js_files = sorted(FILES.rglob('*.js'))
    for js in js_files:
        result = subprocess.run(['node', '--check', str(js)], text=True, capture_output=True)
        if result.returncode != 0:
            print(f'[FAIL] node --check {js}\n{result.stderr}', file=sys.stderr)
            return result.returncode
        print(f'[OK] {js.relative_to(ROOT)}')
    print('Package validation passed.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
