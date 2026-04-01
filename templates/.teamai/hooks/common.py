#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

TEAMAI_DIR = ".teamai"
EMPTY_SECTION_LINES = {
    "no promoted entries yet.",
    "- no promoted entries yet.",
    "no candidate entries yet.",
    "- no candidate entries yet.",
}


def configure_stdout() -> None:
    if sys.platform != "win32":
        return

    import io as _io

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    elif hasattr(sys.stdout, "detach"):
        sys.stdout = _io.TextIOWrapper(  # type: ignore[union-attr]
            sys.stdout.detach(),
            encoding="utf-8",
            errors="replace",
        )


def find_repo_root(start: Path | None = None) -> Path:
    current = (start or Path.cwd()).resolve()

    for candidate in [current, *current.parents]:
        if (candidate / ".git").exists() or (candidate / TEAMAI_DIR).is_dir():
            return candidate

    return current


def read_text(path: Path, fallback: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return fallback


def tail_text(path: Path, max_chars: int = 4000) -> str:
    content = read_text(path)
    if len(content) <= max_chars:
        return content
    return content[-max_chars:]


def read_markdown_section(path: Path, heading: str) -> str:
    content = read_text(path)
    if not content.strip():
        return ""

    lines = content.splitlines()
    target_heading = f"## {heading}".strip()
    in_section = False
    section_lines: list[str] = []

    for line in lines:
        if line.startswith("## "):
            if in_section:
                break
            in_section = line.strip() == target_heading
            continue

        if in_section:
            section_lines.append(line)

    return "\n".join(section_lines).strip()


def read_json(path: Path) -> dict[str, object] | None:
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return None

    if isinstance(data, dict):
        return data
    return None


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def write_json(path: Path, data: dict[str, object]) -> None:
    write_text(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def load_latest_evidence(repo_root: Path) -> dict[str, object]:
    evidence = read_json(repo_root / TEAMAI_DIR / "evidence" / "latest.json")
    return evidence or {}


def normalize_text(text: str) -> str:
    normalized = text.strip().lower()
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = re.sub(r"[`*_#>\-]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def prepare_injected_section(
    text: str,
    *,
    max_lines: int = 24,
    max_chars: int = 2400,
) -> str:
    if not text.strip():
        return ""

    filtered_lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue
        if normalize_text(line) in EMPTY_SECTION_LINES:
            continue
        filtered_lines.append(line)

    if not filtered_lines:
        return ""

    trimmed_lines = filtered_lines[:max_lines]
    trimmed = "\n".join(trimmed_lines).strip()
    if len(trimmed) <= max_chars:
        return trimmed

    sliced = trimmed[:max_chars].rstrip()
    if "\n" in sliced:
        sliced = sliced.rsplit("\n", 1)[0].rstrip()
    return sliced


def fingerprint_text(text: str) -> str:
    normalized = normalize_text(text)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def slugify(text: str, fallback: str = "item") -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return slug or fallback
