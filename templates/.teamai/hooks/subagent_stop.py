#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import sys
from pathlib import Path

from common import configure_stdout, find_repo_root
from pipeline import (
    extract_json,
    find_request_by_agent_id,
    get_agent_id,
    get_agent_type,
    get_last_assistant_message,
    get_session_id,
    get_stop_summary_config,
    list_summary_requests,
    load_config,
    load_summary_state,
    now_iso,
    persist_summary,
    save_summary_state,
)


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
    if subagent_type != str(stop_config["agentName"]):
        print(json.dumps({"continue": True, "suppressOutput": True}))
        return

    state = load_summary_state(repo_root)
    request = find_request_by_agent_id(state, get_agent_id(input_data))
    if request is None:
        requests = list_summary_requests(
            state,
            session_id=get_session_id(input_data),
            statuses={"pending", "running"},
        )
        request = requests[0] if requests else None

    if request is None:
        print(json.dumps({"continue": True, "suppressOutput": True}))
        return

    last_message = get_last_assistant_message(input_data)
    payload = extract_json(last_message)
    request["updatedAt"] = now_iso()
    if payload is None:
        request["status"] = "failed"
        request["failureReason"] = "Subagent output did not contain valid JSON."
        save_summary_state(repo_root, state)
        print(json.dumps({"continue": True, "suppressOutput": True}))
        return

    event = request.get("event")
    if not isinstance(event, dict):
        request["status"] = "failed"
        request["failureReason"] = "Missing TeamAI summary request event."
        save_summary_state(repo_root, state)
        print(json.dumps({"continue": True, "suppressOutput": True}))
        return

    evidence = persist_summary(
        repo_root,
        event,
        payload,
        str(stop_config["agentName"]),
        {
            "stopSummary": True,
            "summaryRequestId": request.get("requestId"),
            "assistantMessageChars": request.get("assistantMessageChars"),
            "subagentType": subagent_type,
            "agentId": get_agent_id(input_data),
        },
    )
    request["status"] = "completed"
    request["completedAt"] = now_iso()
    request["updatedAt"] = request["completedAt"]
    request["evidenceEventId"] = evidence.get("eventId")
    save_summary_state(repo_root, state)
    print(json.dumps({"continue": True, "suppressOutput": True}))


if __name__ == "__main__":
    main()
