#!/usr/bin/env python3
"""Conservative source-candidate secret pattern gate.

The scan covers tracked and non-ignored untracked files when a Git worktree is
present. In an extracted release package, it covers all source files except
known build/cache directories. It never prints a matched value, only the file
and rule identifier.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import sys

RULES = {
    "private-key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "aws-access-key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "github-token": re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b"),
    "azure-storage-key": re.compile(r"AccountKey=[A-Za-z0-9+/=]{40,}"),
    "servicebus-connection-string": re.compile(
        r"Endpoint=sb://[^;\s]+;SharedAccessKeyName=[^;\s]+;SharedAccessKey=[^;\s]+"
    ),
    "postgres-url-password": re.compile(r"postgres(?:ql)?://[^:\s/]+:[^@\s]+@", re.I),
    "generic-assignment": re.compile(
        r"(?i)\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['\"]([^'\"]{24,})['\"]"
    ),
}

ALLOWED_SUFFIXES = {
    ".js", ".ts", ".tsx", ".json", ".yml", ".yaml", ".tf", ".md",
    ".sh", ".py", ".env", ".example", ".txt", ".xml", ".sql"
}

ALLOWED_MARKERS = (
    "example", "placeholder", "changeme", "replace-me", "<secret>",
    "${", "{{", "dummy", "test-only", "not-a-secret", "example.invalid"
)

IGNORED_PARTS = {
    ".git", "node_modules", ".terraform", "__pycache__", "artifacts",
    ".next", "coverage", ".nyc_output", "dist", "out"
}


def candidate_files(root: Path) -> list[Path]:
    if (root / ".git").is_dir():
        proc = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd=root,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if proc.returncode == 0:
            paths = {
                root / raw.decode("utf-8")
                for raw in proc.stdout.split(b"\0")
                if raw
            }
            return sorted(
                (path for path in paths if path.is_file()),
                key=lambda path: path.as_posix(),
            )

    return sorted(
        (
            path
            for path in root.rglob("*")
            if path.is_file()
            and not any(part in IGNORED_PARTS for part in path.relative_to(root).parts)
        ),
        key=lambda path: path.as_posix(),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.repo.resolve()
    findings: list[tuple[str, str]] = []
    scanned = 0

    for path in candidate_files(root):
        if not path.is_file() or path.stat().st_size > 2_000_000:
            continue
        if path.suffix.lower() not in ALLOWED_SUFFIXES and path.name not in {"Dockerfile", ".npmrc"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        scanned += 1
        for rule, pattern in RULES.items():
            for match in pattern.finditer(text):
                sample = match.group(0).lower()
                if any(marker in sample for marker in ALLOWED_MARKERS):
                    continue
                findings.append((path.relative_to(root).as_posix(), rule))

    if findings:
        for relative, rule in sorted(set(findings)):
            print(f"SECRET_PATTERN_FINDING file={relative} rule={rule}", file=sys.stderr)
        print("SECRET_PATTERN_SCAN_OK=false", file=sys.stderr)
        return 1

    print(f"SECRET_PATTERN_FILES_SCANNED={scanned}")
    print("SECRET_PATTERN_SCAN_OK=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
