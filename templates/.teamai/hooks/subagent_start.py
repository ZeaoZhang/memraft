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
from pipeline import (
    ensure_compiled_artifacts,
    get_agent_id,
    get_agent_type,
    get_artifact_path,
    get_session_id,
    get_stop_summary_config,
    list_summary_requests,
    load_config,
    load_summary_state,
    now_iso,
    save_summary_state,
)


def build_shared_context(repo_root: Path) -> str:
    ensure_compiled_artifacts(repo_root)
    config = load_config(repo_root)
    injection_path = get_artifact_path(
        repo_root,
        config,
        "subagentInjectionPath",
        "generated/inject/subagent.txt",
    )
    return read_text(injection_path).strip()


def build_summary_request_context(request: dict[str, object]) -> str:
    request_id = str(request.get("requestId", "unknown"))
    assistant_excerpt = str(request.get("assistantMessageExcerpt", "")).strip()
    files = request.get("filesSnapshot", [])

    parts = [
        "<teamai-summary-request>",
        f"summary_request_id: {request_id}",
        "Return strict JSON only with keys `summary`, `knowledge`, and `candidate_spec`.",
        "",
    ]

    if assistant_excerpt:
        parts.extend(
            [
                "Last assistant message excerpt:",
                assistant_excerpt,
                "",
            ]
        )

    if isinstance(files, list):
        file_lines = [f"- {item}" for item in files if isinstance(item, str) and item]
        if file_lines:
            parts.extend(["Relevant changed files:", *file_lines, ""])

    parts.append("</teamai-summary-request>")
    return "\n".join(parts)


def main() -> None:
    configure_stdout()

    try:
        input_data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        input_data = {}

    cwd_value = input_data.get("cwd")
    if isinstance(cwd_value, str) and cwd_value:
        repo_root = find_repo_root(Path(cwd_value))
    else:
        repo_root = find_repo_root()

    config = load_config(repo_root)
    stop_config = get_stop_summary_config(config)
    subagent_type = get_agent_type(input_data)
    subagent_id = get_agent_id(input_data)
    session_id = get_session_id(input_data)

    parts = []
    shared_context = build_shared_context(repo_root)
    if shared_context:
        parts.append(shared_context)

    if subagent_type == str(stop_config["agentName"]):
        state = load_summary_state(repo_root)
        requests = list_summary_requests(
            state,
            session_id=session_id,
            statuses={"pending", "running"},
        )
        if requests:
            request = requests[0]
            if subagent_id:
                request["agentId"] = subagent_id
            request["status"] = "running"
            request["updatedAt"] = now_iso()
            save_summary_state(repo_root, state)
            parts.append(build_summary_request_context(request))

    if not parts:
        sys.exit(0)

    result = {
        "hookSpecificOutput": {
            "hookEventName": "SubagentStart",
            "additionalContext": "\n\n".join(parts).strip(),
        }
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
