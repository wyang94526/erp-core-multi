#!/usr/bin/env python3
# @author: Wendy Yang
# @date: 2026-09-19

"""Add or normalize the @author header on project source files."""

from __future__ import annotations

import re
from pathlib import Path

AUTHOR_MARK = "@author: Wendy Yang"
DATE_LINE = "@date: 2026-09-19"

SKIP_DIR_NAMES = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "dist",
    "build",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    "coverage",
    "chroma",
}

EXTENSIONS = {".py", ".ts", ".tsx"}

LINE_AUTHOR_HEADER = re.compile(
    r"^(?://|#) @author: Wendy Yang\n(?://|#) @date: 2026-09-19\n\n?",
    re.MULTILINE,
)
TS_FILE_DOC = re.compile(r"^/\*\*(.*?)\*/\n?", re.DOTALL)


def python_header() -> str:
    return f"# {AUTHOR_MARK}\n# {DATE_LINE}\n\n"


def ts_header_block(body: str | None = None) -> str:
    lines = [f" * {AUTHOR_MARK}", f" * {DATE_LINE}"]
    extra = (body or "").strip("\n")
    if extra:
        lines.append(" *")
        for raw in extra.splitlines():
            stripped = raw.rstrip()
            if stripped in {"", "*"}:
                lines.append(" *")
            elif stripped.startswith(" *"):
                lines.append(stripped)
            elif stripped.startswith("*"):
                lines.append(" " + stripped)
            else:
                lines.append(" * " + stripped)
        while len(lines) > 2 and lines[-1] in {" *", "*"}:
            lines.pop()
    return "/**\n" + "\n".join(lines) + "\n */\n\n"


def should_skip_dir(path: Path) -> bool:
    return path.name in SKIP_DIR_NAMES or path.name.startswith(".")


def iter_source_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in EXTENSIONS:
            continue
        if any(should_skip_dir(parent) for parent in path.relative_to(root).parents):
            continue
        files.append(path)
    return sorted(files)


TRAILING_STAR = re.compile(r"(\n \*)+\n \*/", re.MULTILINE)


def normalize_typescript(text: str) -> str:
    if text.startswith("/**") and AUTHOR_MARK in text[:400]:
        cleaned = TRAILING_STAR.sub("\n */", text, count=1)
        return cleaned

    remainder = LINE_AUTHOR_HEADER.sub("", text, count=1)
    match = TS_FILE_DOC.match(remainder)
    if match:
        body = match.group(1)
        rest = remainder[match.end() :]
        if rest.startswith("\n"):
            rest = rest[1:]
        return ts_header_block(body) + rest
    return ts_header_block() + remainder.lstrip("\n")


def normalize_python(text: str) -> str:
    if AUTHOR_MARK in text:
        return text
    header = python_header()
    if text.startswith("#!"):
        if "\n" in text:
            first, rest = text.split("\n", 1)
            return f"{first}\n{header}{rest}"
        return f"{text}\n{header}"
    return header + text


def apply_header(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")
    if path.suffix == ".py":
        updated = normalize_python(original)
    else:
        updated = normalize_typescript(original)
    if updated == original:
        return False
    path.write_text(updated, encoding="utf-8")
    return True


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    changed = 0
    skipped = 0
    for path in iter_source_files(root):
        if apply_header(path):
            changed += 1
            print(f"updated  {path.relative_to(root)}")
        else:
            skipped += 1
    print(f"\nDone. {changed} files updated, {skipped} unchanged.")


if __name__ == "__main__":
    main()
