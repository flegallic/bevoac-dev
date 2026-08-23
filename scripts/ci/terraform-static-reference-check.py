#!/usr/bin/env python3
"""Dependency-free Terraform source sanity checks.

This is deliberately not a replacement for `terraform fmt` or
`terraform validate`. It catches release-packaging mistakes even where the
Terraform binary is unavailable: undeclared variables, duplicate block
identifiers, obvious brace imbalance, mutable image tags and active placeholder
URLs.
"""
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
import re
import sys

BLOCK_RE = re.compile(
    r'^\s*(resource|data)\s+"([^"]+)"\s+"([^"]+)"\s*\{|^\s*module\s+"([^"]+)"\s*\{',
    re.MULTILINE,
)
VARIABLE_RE = re.compile(r'^\s*variable\s+"([A-Za-z0-9_]+)"\s*\{', re.MULTILINE)
VARIABLE_REF_RE = re.compile(r'\bvar\.([A-Za-z0-9_]+)\b')
LATEST_IMAGE_RE = re.compile(r'(?i)(?:image\s*=\s*"[^"]*|[A-Za-z0-9._/-]+):latest(?:"|\b)')
PLACEHOLDER_URL_RE = re.compile(r'https://example\.com\b', re.I)
CONDITIONAL_HEREDOC_RE = re.compile(r'\?\s*<<-?\s*[A-Za-z_][A-Za-z0-9_]*')


def strip_hcl_non_structure(text: str) -> str:
    """Remove strings/comments/heredoc bodies while preserving braces outside them."""
    output: list[str] = []
    i = 0
    n = len(text)
    in_string = False
    in_block_comment = False
    line_start = True
    heredoc_end: str | None = None

    while i < n:
        if heredoc_end is not None:
            end = text.find("\n", i)
            if end == -1:
                line = text[i:]
                i = n
            else:
                line = text[i:end]
                i = end + 1
            if line.strip() == heredoc_end:
                heredoc_end = None
            output.append("\n")
            line_start = True
            continue

        if in_block_comment:
            end = text.find("*/", i)
            if end == -1:
                break
            output.append("\n" * text[i:end + 2].count("\n"))
            i = end + 2
            line_start = i == 0 or text[i - 1] == "\n"
            in_block_comment = False
            continue

        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""

        if in_string:
            if ch == "\\":
                i += 2
                continue
            if ch == '"':
                in_string = False
            if ch == "\n":
                output.append("\n")
                line_start = True
            i += 1
            continue

        if ch == '"':
            in_string = True
            i += 1
            continue
        if ch == "/" and nxt == "*":
            in_block_comment = True
            i += 2
            continue
        if ch == "/" and nxt == "/":
            end = text.find("\n", i)
            if end == -1:
                break
            output.append("\n")
            i = end + 1
            line_start = True
            continue
        if ch == "#":
            end = text.find("\n", i)
            if end == -1:
                break
            output.append("\n")
            i = end + 1
            line_start = True
            continue

        if ch == "<" and nxt == "<":
            match = re.match(r'<<-?\s*([A-Za-z_][A-Za-z0-9_]*)', text[i:])
            if match:
                heredoc_end = match.group(1)
                end = text.find("\n", i)
                if end == -1:
                    break
                output.append("\n")
                i = end + 1
                line_start = True
                continue

        output.append(ch)
        line_start = ch == "\n"
        i += 1

    return "".join(output)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    args = parser.parse_args()
    repo = args.repo.resolve()
    iac = repo / "bevoac-iac-enterprise"
    files = sorted(iac.glob("*.tf"))
    if not files:
        print("TERRAFORM_STATIC_ERROR=no Terraform files found", file=sys.stderr)
        return 1

    texts = {path: path.read_text(encoding="utf-8") for path in files}
    combined = "\n".join(texts.values())

    declared = set(VARIABLE_RE.findall(combined))
    referenced = set(VARIABLE_REF_RE.findall(combined))
    missing = sorted(referenced - declared)
    if missing:
        print(f"TERRAFORM_STATIC_ERROR=undeclared variables: {missing}", file=sys.stderr)
        return 1

    identifiers: list[str] = []
    for path, text in texts.items():
        for match in BLOCK_RE.finditer(text):
            if match.group(1):
                identifiers.append(f"{match.group(1)}.{match.group(2)}.{match.group(3)}")
            else:
                identifiers.append(f"module.{match.group(4)}")
    duplicates = sorted(key for key, count in Counter(identifiers).items() if count > 1)
    if duplicates:
        print(f"TERRAFORM_STATIC_ERROR=duplicate blocks: {duplicates}", file=sys.stderr)
        return 1

    for path, text in texts.items():
        structure = strip_hcl_non_structure(text)
        balance = 0
        for ch in structure:
            if ch == "{":
                balance += 1
            elif ch == "}":
                balance -= 1
                if balance < 0:
                    print(f"TERRAFORM_STATIC_ERROR=unexpected closing brace: {path}", file=sys.stderr)
                    return 1
        if balance != 0:
            print(f"TERRAFORM_STATIC_ERROR=unbalanced braces ({balance}): {path}", file=sys.stderr)
            return 1
        if PLACEHOLDER_URL_RE.search(text):
            print(f"TERRAFORM_STATIC_ERROR=active example.com placeholder: {path}", file=sys.stderr)
            return 1
        if CONDITIONAL_HEREDOC_RE.search(text):
            print(
                f"TERRAFORM_STATIC_ERROR=conditional heredoc is forbidden; use a template directive or join(): {path}",
                file=sys.stderr,
            )
            return 1
        if LATEST_IMAGE_RE.search(text):
            print(f"TERRAFORM_STATIC_ERROR=mutable latest image reference: {path}", file=sys.stderr)
            return 1

    print(f"TERRAFORM_STATIC_FILES={len(files)}")
    print(f"TERRAFORM_STATIC_VARIABLES={len(declared)}")
    print(f"TERRAFORM_STATIC_BLOCKS={len(identifiers)}")
    print("TERRAFORM_STATIC_REFERENCE_CHECK_OK=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
