#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import sys
from pathlib import Path

from common import (
    configure_stdout,
    find_repo_root,
    read_text,
)
from pipeline import ensure_compiled_artifacts, get_artifact_path, load_config


def build_shared_context(repo_root: Path) -> str:
    ensure_compiled_artifacts(repo_root)
    config = load_config(repo_root)
    injection_path = get_artifact_path(
        repo_root,
        config,
        "toolInjectionPath",
        "generated/inject/tool-task.txt",
    )
    return read_text(injection_path).strip()


def main() -> None:
    configure_stdout()

    try:
        input_data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    if tool_name not in ("Task", "Agent"):
        sys.exit(0)

    tool_input = input_data.get("tool_input", {})
    if not isinstance(tool_input, dict):
        sys.exit(0)

    original_prompt = tool_input.get("prompt", "")
    if not isinstance(original_prompt, str) or not original_prompt.strip():
        sys.exit(0)

    cwd_value = input_data.get("cwd")
    if isinstance(cwd_value, str) and cwd_value:
        repo_root = find_repo_root(Path(cwd_value))
    else:
        repo_root = find_repo_root()

    context = build_shared_context(repo_root)
    if not context:
        sys.exit(0)

    new_prompt = (
        f"<teamai-shared-context>\n{context}\n</teamai-shared-context>\n\n"
        f"{original_prompt}"
    )

    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": {**tool_input, "prompt": new_prompt},
        }
    }
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
