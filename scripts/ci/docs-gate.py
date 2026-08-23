#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys

REQUIRED = (
    "docs/README.md",
    "docs/operations/runbook-v6-2.md",
    "docs/operations/monitoring-alerting-v6-2.md",
    "docs/operations/incident-response-v6-2.md",
    "docs/operations/postgres-backup-restore-v6-2.md",
    "docs/operations/release-validation-v6-2.md",
    "docs/technical/architecture-v6-2.md",
    "docs/technical/security-model-v6-2.md",
    "docs/technical/api-contract-v6-2.md",
    "docs/client/client-presentation-safe-v6-2.md",
    "docs/testing/test-strategy-v6-2.md",
    "docs/evidence/FINDINGS_CLOSURE_V6_2.md",
    "docs/evidence/FINDINGS_CLOSURE_V6_2.csv",
    "docs/evidence/SOURCE_VALIDATION_V6_2_0.md",
    "docs/MANIFEST.md",
    "CHANGELOG_V6_2_0.md",
    "APPLY_V6_2_0.md",
    "VALIDATION_MATRIX_V6_2_0.md",
    "SOURCE_BASELINE.json",
    "REMEDIATION_CLOSURE_MATRIX.md",
    "PACKAGE_CONTENTS.md",
    "RELEASE_CANDIDATE_LIMITATIONS.md",
    "VALIDATION_REPORT_V6_2_0.md",
    "SOURCE_CHANGE_SUMMARY.md",
)

FORBIDDEN_CLAIMS = (
    "enterprise-certified",
    "zero residual risk",
    "zero-risk tenant",
    "pentest-validated",
)

ACTIVE_DIRS = ("docs/operations", "docs/technical", "docs/client", "docs/testing")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.repo.resolve()
    errors: list[str] = []

    for relative in REQUIRED:
        if not (root / relative).is_file():
            errors.append(f"missing required document: {relative}")

    # Active README and V6.2 documents must not claim an obsolete baseline.
    for relative in REQUIRED:
        path = root / relative
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        lowered = text.lower()
        if relative != "docs/evidence/FINDINGS_CLOSURE_V6_2.md":
            for claim in FORBIDDEN_CLAIMS:
                if claim in lowered and "interdit" not in lowered and "ne pas" not in lowered:
                    errors.append(f"forbidden unqualified claim in {relative}: {claim}")

    # Product release names must not version internal message contracts.
    for path in (root / "bevoac-worker-enterprise/contracts").glob("*multicloud*"):
        if "v7" in path.name.lower() or "v6-3" in path.name.lower():
            errors.append(f"contract filename coupled to product release: {path.relative_to(root)}")

    # Markdown links pointing to local files must resolve for the active V6.2 corpus.
    link_re = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
    for relative in REQUIRED:
        path = root / relative
        if not path.is_file() or path.suffix != ".md":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for target in link_re.findall(text):
            if target.startswith(("http://", "https://", "#", "mailto:")):
                continue
            target = target.split("#", 1)[0]
            if not target:
                continue
            if not (path.parent / target).resolve().exists():
                errors.append(f"broken link in {relative}: {target}")

    if errors:
        for error in errors:
            print(f"DOCS_GATE_ERROR={error}", file=sys.stderr)
        print("DOCS_GATE_OK=false", file=sys.stderr)
        return 1

    print("DOCS_GATE_OK=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
