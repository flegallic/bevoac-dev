# Dependency evidence

- `api-node24-npm-audit-zero.json`: exact npm audit output from the successful API R2.1 dependency tree on Node.js 24.19.0.
- `worker-r2-audit-before-closure.json`: original worker audit that identified the deprecated Resource Graph SDK chain.
- `worker-r2.1-static-closure.json`: machine-readable comparison proving the reported vulnerable chain is absent from the final worker lockfile.
- `../sbom/api.cdx.json` and `../sbom/worker.cdx.json`: deterministic CycloneDX 1.6 inventories generated from the final lockfiles.
