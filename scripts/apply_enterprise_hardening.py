#!/usr/bin/env python3
"""Apply Bevoac V6.1.2 enterprise hardening package.

The script copies files from package/files into the repository and patches package.json scripts.
It is intentionally conservative: existing overwritten files are backed up first.
"""
from __future__ import annotations
import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

API_SCRIPTS = {
    "migrate-db:enterprise-hardening": "node scripts/apply-enterprise-hardening-migration.js",
    "migrate-db:enterprise-rls": "node scripts/apply-enterprise-rls.js",
    "check:enterprise-hardening": "node scripts/check-enterprise-hardening.js",
    "check:tenant-isolation:enterprise": "node scripts/check-tenant-isolation-enterprise.js"
}


def patch_package_json(path: Path, scripts: dict[str, str], dry_run: bool) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    current = data.setdefault("scripts", {})
    changed = False
    for key, value in scripts.items():
        if current.get(key) != value:
            current[key] = value
            changed = True
    if changed:
        print(f"[PATCH] {path}")
        if not dry_run:
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    else:
        print(f"[OK] {path} already contains required scripts")


def copy_tree(package_root: Path, repo_root: Path, dry_run: bool) -> None:
    files_root = package_root / "files"
    if not files_root.exists():
        raise SystemExit(f"Missing files directory: {files_root}")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_root = repo_root / ".bevoac-enterprise-hardening-backup" / timestamp
    for src in sorted(p for p in files_root.rglob("*") if p.is_file()):
        rel = src.relative_to(files_root)
        dst = repo_root / rel
        print(f"[COPY] {rel}")
        if dry_run:
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            backup = backup_root / rel
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dst, backup)
        shutil.copy2(src, dst)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True, help="Path to Bevoac repository root")
    parser.add_argument("--package-root", required=True, help="Path to this package root")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="Reserved for future use; current application is idempotent")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    package_root = Path(args.package_root).resolve()
    if not (repo_root / "bevoac-api-enterprise").exists():
        raise SystemExit(f"Invalid repo root: {repo_root} does not contain bevoac-api-enterprise")
    if not (repo_root / "bevoac-worker-enterprise").exists():
        raise SystemExit(f"Invalid repo root: {repo_root} does not contain bevoac-worker-enterprise")

    copy_tree(package_root, repo_root, args.dry_run)
    patch_package_json(repo_root / "bevoac-api-enterprise" / "package.json", API_SCRIPTS, args.dry_run)
    print("\nEnterprise hardening package applied." if not args.dry_run else "\nDry-run completed.")
    print("Next: run the commands in VALIDATION_MATRIX.md")

if __name__ == "__main__":
    main()
