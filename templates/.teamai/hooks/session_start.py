#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from common import (
    configure_stdout,
    find_repo_root,
    read_text,
)
from pipeline import ensure_compiled_artifacts, get_artifact_path, load_config


def should_skip_injection() -> bool:
    return os.environ.get("CLAUDE_NON_INTERACTIVE") == "1"


def build_context(repo_root: Path) -> str:
    ensure_compiled_artifacts(repo_root)
    config = load_config(repo_root)
    injection_path = get_artifact_path(
        repo_root,
        config,
        "sessionStartInjectionPath",
        "generated/inject/session-start.txt",
    )
    return read_text(injection_path).strip()


def main() -> None:
    configure_stdout()

    if should_skip_injection():
        sys.exit(0)

    try:
        input_data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        input_data = {}

    cwd_value = input_data.get("cwd")
    if isinstance(cwd_value, str) and cwd_value:
        repo_root = find_repo_root(Path(cwd_value))
    else:
        repo_root = find_repo_root()

    context = build_context(repo_root)
    result = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        }
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
