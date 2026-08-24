#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

HIGH_THRESHOLD = 7.0


def sarif_files(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    if target.is_dir():
        return sorted(p for p in target.rglob("*.sarif") if p.is_file())
    return []


def severity_for_result(run: dict, result: dict) -> float | None:
    raw = (result.get("properties") or {}).get("security-severity")
    if raw is not None:
        try:
            return float(raw)
        except (TypeError, ValueError):
            pass

    driver = ((run.get("tool") or {}).get("driver") or {})
    rules = driver.get("rules") or []
    rule = None
    idx = result.get("ruleIndex")
    if isinstance(idx, int) and 0 <= idx < len(rules):
        rule = rules[idx]
    else:
        rid = result.get("ruleId")
        if rid:
            rule = next((r for r in rules if r.get("id") == rid), None)
    if not rule:
        return None
    raw = (rule.get("properties") or {}).get("security-severity")
    try:
        return float(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def evaluate(target: Path) -> int:
    files = sarif_files(target)
    if not files:
        print(f"CODEQL_SARIF_GATE_ERROR=no SARIF files found under {target}", file=sys.stderr)
        return 2

    findings: list[tuple[str, str, float, str]] = []
    total_results = 0
    for file in files:
        data = json.loads(file.read_text(encoding="utf-8"))
        for run in data.get("runs") or []:
            for result in run.get("results") or []:
                total_results += 1
                severity = severity_for_result(run, result)
                if severity is None or severity < HIGH_THRESHOLD:
                    continue
                rid = str(result.get("ruleId") or "unknown-rule")
                message = str(((result.get("message") or {}).get("text")) or "").replace("\\n", " ")
                findings.append((file.name, rid, severity, message[:300]))

    print(f"CODEQL_SARIF_FILES={len(files)}")
    print(f"CODEQL_SARIF_RESULTS={total_results}")
    print(f"CODEQL_HIGH_CRITICAL_FINDINGS={len(findings)}")
    if findings:
        for file, rid, severity, message in findings:
            print(f"CODEQL_BLOCKING_FINDING={file}|{rid}|{severity:.1f}|{message}", file=sys.stderr)
        print("CODEQL_SARIF_GATE_OK=false", file=sys.stderr)
        return 1
    print("CODEQL_SARIF_GATE_OK=true")
    return 0


def self_test() -> int:
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        clean = root / "clean.sarif"
        high = root / "high.sarif"
        data = {
            "version": "2.1.0",
            "runs": [{
                "tool": {"driver": {"name": "CodeQL", "rules": [{
                    "id": "js/test",
                    "properties": {"security-severity": "5.0"},
                }]}},
                "results": [{"ruleId": "js/test", "ruleIndex": 0, "message": {"text": "test"}}],
            }],
        }
        clean.write_text(json.dumps(data), encoding="utf-8")
        if evaluate(clean) != 0:
            return 10
        data["runs"][0]["tool"]["driver"]["rules"][0]["properties"]["security-severity"] = "9.8"
        high.write_text(json.dumps(data), encoding="utf-8")
        if evaluate(high) != 1:
            return 11
    print("CODEQL_SARIF_GATE_SELFTEST_OK=true")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("target", nargs="?", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if args.target is None:
        parser.error("target SARIF file/directory is required unless --self-test is used")
    return evaluate(args.target)


if __name__ == "__main__":
    raise SystemExit(main())
