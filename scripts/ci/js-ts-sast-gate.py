#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Iterable

SCANNED_ROOTS = (
    "bevoac-api-enterprise",
    "bevoac-worker-enterprise",
    "bevoac-frontend-enterprise",
    "scripts",
)
EXTENSIONS = {".js", ".cjs", ".mjs", ".ts", ".tsx"}
EXCLUDED_PARTS = {
    "node_modules",
    ".next",
    ".terraform",
    "coverage",
    "artifacts",
    "evidence",
    "__pycache__",
}


@dataclass(frozen=True)
class Rule:
    rule_id: str
    title: str
    message: str
    pattern: re.Pattern[str]
    severity: float


RULES = (
    Rule(
        "bevoac.js.dynamic-eval",
        "Dynamic eval is forbidden",
        "Do not execute dynamically constructed JavaScript with eval().",
        re.compile(r"(?<![.\w])eval\s*\("),
        9.8,
    ),
    Rule(
        "bevoac.js.dynamic-function",
        "Dynamic Function constructor is forbidden",
        "Do not execute dynamically constructed JavaScript with new Function().",
        re.compile(r"\bnew\s+Function\s*\("),
        9.8,
    ),
    Rule(
        "bevoac.js.vm-code-execution",
        "Node VM code execution is forbidden",
        "Do not execute untrusted code with Node.js VM execution helpers.",
        re.compile(r"\b(?:vm\.)?(?:runInThisContext|runInNewContext|runInContext|compileFunction)\s*\("),
        9.8,
    ),
    Rule(
        "bevoac.node.shell-command-exec",
        "Shell command execution is forbidden",
        "Use execFile/spawn with fixed executables and argument arrays; exec/execSync invoke a shell.",
        re.compile(r"(?<!\w)(?:(?:cp|childProcess|child_process)\.)?(?:exec|execSync)\s*\("),
        9.1,
    ),
    Rule(
        "bevoac.node.shell-true",
        "child_process shell mode is forbidden",
        "Do not set shell: true on child_process calls.",
        re.compile(r"\bshell\s*:\s*true\b"),
        9.1,
    ),
    Rule(
        "bevoac.node.global-tls-disable",
        "Global TLS verification disable is forbidden",
        "Do not set NODE_TLS_REJECT_UNAUTHORIZED; keep certificate validation enabled.",
        re.compile(r"NODE_TLS_REJECT_UNAUTHORIZED"),
        9.8,
    ),
    Rule(
        "bevoac.node.tls-verification-disabled",
        "TLS verification is disabled",
        "rejectUnauthorized: false is allowed only in the two documented certificate/diagnostic probes.",
        re.compile(r"rejectUnauthorized\s*:\s*false"),
        8.8,
    ),
    Rule(
        "bevoac.crypto.weak-hash",
        "Weak cryptographic hash is forbidden",
        "Do not use MD5 or SHA-1 for security-sensitive hashing.",
        re.compile(r"createHash\s*\(\s*['\"](?:md5|sha1)['\"]\s*\)", re.IGNORECASE),
        8.2,
    ),
    Rule(
        "bevoac.web.raw-html-sink",
        "Raw HTML injection sink is forbidden",
        "Avoid dangerouslySetInnerHTML and direct innerHTML assignment.",
        re.compile(r"dangerouslySetInnerHTML|\.innerHTML\s*="),
        8.8,
    ),
    Rule(
        "bevoac.web.wildcard-cors",
        "Wildcard CORS is forbidden",
        "Do not allow every origin for authenticated or tenant-scoped APIs.",
        re.compile(r"Access-Control-Allow-Origin[^\n]*['\"]\*['\"]|\borigin\s*:\s*['\"]\*['\"]"),
        8.2,
    ),
)

# These are deliberate security-audit probes, not production transport defaults.
ALLOWLIST: dict[tuple[str, str], str] = {
    (
        "bevoac-worker-enterprise/scanners/generic/checkSSL.js",
        "bevoac.node.tls-verification-disabled",
    ): "The scanner must complete a handshake to inspect and report invalid certificates.",
    (
        "bevoac-api-enterprise/scripts/check-db-enterprise.js",
        "bevoac.node.tls-verification-disabled",
    ): "Read-only diagnostic helper used to inspect an existing database endpoint.",
}


@dataclass(frozen=True)
class Finding:
    rule: Rule
    path: str
    line: int
    column: int
    excerpt: str


def git_files(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        return []
    return sorted(raw.decode("utf-8") for raw in result.stdout.split(b"\0") if raw)


def candidate_files(root: Path) -> list[Path]:
    names = git_files(root)
    if names:
        paths = [root / name for name in names]
    else:
        paths = [p for base in SCANNED_ROOTS for p in (root / base).rglob("*") if p.is_file()]

    selected: list[Path] = []
    for path in paths:
        try:
            relative = path.relative_to(root)
        except ValueError:
            continue
        if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
            continue
        if not relative.parts or relative.parts[0] not in SCANNED_ROOTS:
            continue
        if any(part in EXCLUDED_PARTS for part in relative.parts):
            continue
        selected.append(path)
    return sorted(set(selected))


def line_column(text: str, offset: int) -> tuple[int, int]:
    line = text.count("\n", 0, offset) + 1
    start = text.rfind("\n", 0, offset) + 1
    return line, offset - start + 1


def scan_text(path: str, text: str) -> list[Finding]:
    findings: list[Finding] = []
    for rule in RULES:
        if (path, rule.rule_id) in ALLOWLIST:
            continue
        for match in rule.pattern.finditer(text):
            line, column = line_column(text, match.start())
            excerpt = text.splitlines()[line - 1].strip()[:300] if text.splitlines() else ""
            findings.append(Finding(rule, path, line, column, excerpt))

    # execFile is acceptable only with a fixed literal executable. This catches
    # accidental reintroduction of attacker-controlled executable names.
    for match in re.finditer(r"\bexecFile(?:Sync)?\s*\(\s*([^,\n]+)", text):
        first_arg = match.group(1).strip()
        if first_arg.startswith(("'", '"', "`")):
            continue
        rule = Rule(
            "bevoac.node.dynamic-execfile",
            "Dynamic execFile executable is forbidden",
            "Use a fixed executable name and pass untrusted data only through the argument array.",
            re.compile(r"$^"),
            9.1,
        )
        line, column = line_column(text, match.start())
        excerpt = text.splitlines()[line - 1].strip()[:300]
        findings.append(Finding(rule, path, line, column, excerpt))

    return findings


def scan_repo(root: Path) -> tuple[list[Path], list[Finding]]:
    files = candidate_files(root)
    findings: list[Finding] = []
    for file in files:
        relative = file.relative_to(root).as_posix()
        text = file.read_text(encoding="utf-8", errors="replace")
        findings.extend(scan_text(relative, text))
    findings.sort(key=lambda item: (item.path, item.line, item.column, item.rule.rule_id))
    return files, findings


def sarif_document(findings: Iterable[Finding]) -> dict:
    findings = list(findings)
    unique_rules = {finding.rule.rule_id: finding.rule for finding in findings}
    # Emit every configured rule, not only triggered rules, so the artifact
    # documents the complete policy that was enforced.
    for rule in RULES:
        unique_rules.setdefault(rule.rule_id, rule)
    dynamic_rule = Rule(
        "bevoac.node.dynamic-execfile",
        "Dynamic execFile executable is forbidden",
        "Use a fixed executable name and pass untrusted data only through the argument array.",
        re.compile(r"$^"),
        9.1,
    )
    unique_rules.setdefault(dynamic_rule.rule_id, dynamic_rule)

    rules = []
    for rule_id in sorted(unique_rules):
        rule = unique_rules[rule_id]
        rules.append(
            {
                "id": rule.rule_id,
                "name": rule.rule_id.replace(".", "_"),
                "shortDescription": {"text": rule.title},
                "fullDescription": {"text": rule.message},
                "properties": {
                    "security-severity": f"{rule.severity:.1f}",
                    "precision": "high",
                    "tags": ["security", "bevoac", "javascript", "typescript"],
                },
                "defaultConfiguration": {"level": "error"},
            }
        )

    results = []
    for finding in findings:
        results.append(
            {
                "ruleId": finding.rule.rule_id,
                "level": "error",
                "message": {"text": f"{finding.rule.message} Source: {finding.excerpt}"},
                "locations": [
                    {
                        "physicalLocation": {
                            "artifactLocation": {"uri": finding.path},
                            "region": {
                                "startLine": finding.line,
                                "startColumn": finding.column,
                            },
                        }
                    }
                ],
                "properties": {"security-severity": f"{finding.rule.severity:.1f}"},
            }
        )

    return {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "Bevoac JavaScript/TypeScript SAST Policy",
                        "informationUri": "https://github.com/flegallic/bevoac-dev",
                        "semanticVersion": "1.0.0",
                        "rules": rules,
                    }
                },
                "results": results,
            }
        ],
    }


def self_test() -> int:
    cases = {
        "bevoac.js.dynamic-eval": "eval(userInput);",
        "bevoac.js.dynamic-function": "const x = new Function(userInput);",
        "bevoac.js.vm-code-execution": "vm.runInNewContext(userInput, sandbox);",
        "bevoac.node.shell-command-exec": "const cp = require('node:child_process'); cp.exec(userInput);",
        "bevoac.node.shell-true": "spawn('tool', args, { shell: true });",
        "bevoac.node.global-tls-disable": "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';",
        "bevoac.node.tls-verification-disabled": "const options = { rejectUnauthorized: false };",
        "bevoac.crypto.weak-hash": "createHash('sha1').update(value);",
        "bevoac.web.raw-html-sink": "element.innerHTML = userInput;",
        "bevoac.web.wildcard-cors": "const cors = { origin: '*' };",
        "bevoac.node.dynamic-execfile": "execFile(executable, ['-F']);",
    }
    for expected, source in cases.items():
        ids = {finding.rule.rule_id for finding in scan_text("bevoac-api-enterprise/src/bad.js", source)}
        if expected not in ids:
            print(f"JSTS_SAST_SELFTEST_MISSING={expected}", file=sys.stderr)
            return 1

    allowed = scan_text(
        "bevoac-worker-enterprise/scanners/generic/checkSSL.js",
        "const options = { rejectUnauthorized: false };",
    )
    if any(item.rule.rule_id == "bevoac.node.tls-verification-disabled" for item in allowed):
        print("JSTS_SAST_SELFTEST_ALLOWLIST=false", file=sys.stderr)
        return 1

    safe = scan_text(
        "bevoac-worker-enterprise/scanners/generic/runNmap.js",
        "execFile('nmap', ['-F', address], {}, callback);",
    )
    if safe:
        print(f"JSTS_SAST_SELFTEST_SAFE_FINDINGS={len(safe)}", file=sys.stderr)
        return 1

    print("JSTS_SAST_SELFTEST_OK=true")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Deterministic Bevoac JavaScript/TypeScript security gate")
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--sarif", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    root = args.repo.resolve()
    files, findings = scan_repo(root)
    if args.sarif:
        output = args.sarif if args.sarif.is_absolute() else root / args.sarif
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(sarif_document(findings), indent=2) + "\n", encoding="utf-8")
        print(f"JSTS_SAST_SARIF={output}")

    print(f"JSTS_SAST_SCANNED_FILES={len(files)}")
    print(f"JSTS_SAST_FINDINGS={len(findings)}")
    if findings:
        for finding in findings:
            print(
                f"JSTS_SAST_FINDING={finding.rule.rule_id}|{finding.path}:{finding.line}:{finding.column}|{finding.excerpt}",
                file=sys.stderr,
            )
        print("JSTS_SAST_GATE_OK=false", file=sys.stderr)
        return 1

    print("JSTS_SAST_GATE_OK=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
