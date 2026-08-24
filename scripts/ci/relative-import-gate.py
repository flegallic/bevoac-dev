#!/usr/bin/env python3
"""Validate literal relative JavaScript/TypeScript imports without dependencies."""
from __future__ import annotations

from pathlib import Path
import argparse
import re
import sys

SOURCE_SUFFIXES = {".js", ".cjs", ".mjs", ".ts", ".tsx"}
IGNORE_PARTS = {".git", "node_modules", ".next", "dist", "coverage", "artifacts", "archive", "archive_source_reference"}
PATTERNS = (
    re.compile(r"\brequire\(\s*['\"](\.{1,2}/[^'\"]+)['\"]\s*\)"),
    re.compile(r"\bfrom\s+['\"](\.{1,2}/[^'\"]+)['\"]"),
    re.compile(r"\bimport\s*\(\s*['\"](\.{1,2}/[^'\"]+)['\"]\s*\)"),
    re.compile(r"^\s*import\s+['\"](\.{1,2}/[^'\"]+)['\"]", re.M),
)


def candidates(base: Path) -> list[Path]:
    return [
        base,
        *(base.with_suffix(suffix) for suffix in (".js", ".cjs", ".mjs", ".json", ".ts", ".tsx")),
        *(base / f"index{suffix}" for suffix in (".js", ".cjs", ".mjs", ".json", ".ts", ".tsx")),
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.repo.resolve()
    errors: list[str] = []
    checked = 0

    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SOURCE_SUFFIXES:
            continue
        relative_parts = path.relative_to(root).parts
        if any(part in IGNORE_PARTS for part in relative_parts):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for pattern in PATTERNS:
            for match in pattern.finditer(text):
                specifier = match.group(1)
                # Query/hash suffixes are not valid Node CommonJS paths here and
                # are intentionally excluded from this source tree gate.
                specifier = specifier.split("?", 1)[0].split("#", 1)[0]
                target = (path.parent / specifier).resolve()
                checked += 1
                if not any(candidate.is_file() for candidate in candidates(target)):
                    errors.append(
                        f"{path.relative_to(root).as_posix()}: unresolved relative import {match.group(1)}"
                    )

    if errors:
        for error in sorted(set(errors)):
            print(f"RELATIVE_IMPORT_GATE_ERROR={error}", file=sys.stderr)
        print("RELATIVE_IMPORT_GATE_OK=false", file=sys.stderr)
        return 1

    print(f"RELATIVE_IMPORTS_CHECKED={checked}")
    print("RELATIVE_IMPORT_GATE_OK=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
