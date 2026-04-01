#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import sys
from pathlib import Path

from common import configure_stdout, find_repo_root
from pipeline import (
    build_capture_snapshot,
    build_stop_reason,
    build_summary_request,
    find_request_by_message_fingerprint,
    get_capture_config,
    get_last_assistant_message,
    get_session_id,
    get_stop_hook_active,
    get_stop_summary_config,
    load_config,
    load_summary_state,
    save_summary_state,
    should_request_stop_summary,
)


def approve() -> None:
    print(json.dumps({"decision": "approve"}, ensure_ascii=False))


def block(reason: str) -> None:
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


def main() -> None:
    configure_stdout()

    try:
        input_data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        input_data = {}

    cwd_value = input_data.get("cwd", "")
    repo_root = (
        find_repo_root(Path(cwd_value))
        if isinstance(cwd_value, str) and cwd_value
        else find_repo_root()
    )
    config = load_config(repo_root)
    stop_config = get_stop_summary_config(config)
    if not bool(stop_config["enabled"]):
        approve()
        return

    last_message = get_last_assistant_message(input_data).strip()
    if not last_message:
        approve()
        return

    capture_config = get_capture_config(config)
    snapshot = build_capture_snapshot(repo_root, capture_config)
    files = snapshot.get("worktreeFiles", [])
    if not isinstance(files, list):
        files = []

    session_id = get_session_id(input_data)
    request = build_summary_request(input_data, repo_root, stop_config, snapshot)
    message_fingerprint = str(request.get("messageFingerprint"))

    state = load_summary_state(repo_root)
    existing = find_request_by_message_fingerprint(state, session_id, message_fingerprint)
    if isinstance(existing, dict):
        status = str(existing.get("status", ""))
        if status == "completed":
            approve()
            return
        if status in {"pending", "running"}:
            if get_stop_hook_active(input_data):
                block_count = existing.get("blockCount", 0)
                block_count = block_count if isinstance(block_count, int) else 0
                if block_count >= int(stop_config["maxBlockAttempts"]):
                    existing["status"] = "expired"
                    existing["updatedAt"] = str(request.get("createdAt"))
                    save_summary_state(repo_root, state)
                    approve()
                    return
            existing["blockCount"] = int(existing.get("blockCount", 0)) + 1
            existing["updatedAt"] = str(request.get("createdAt"))
            save_summary_state(repo_root, state)
            block(build_stop_reason(existing, stop_config))
            return
        approve()
        return

    if get_stop_hook_active(input_data):
        approve()
        return

    if not should_request_stop_summary(stop_config, files, last_message):
        approve()
        return

    request["blockCount"] = 1
    requests = state.get("requests")
    if not isinstance(requests, dict):
        requests = {}
        state["requests"] = requests
    requests[str(request.get("requestId"))] = request
    save_summary_state(repo_root, state)
    block(build_stop_reason(request, stop_config))


if __name__ == "__main__":
    main()
