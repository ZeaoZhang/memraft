#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from common import configure_stdout, find_repo_root, read_json, write_json
from pipeline import (
    TEAMAI_DIR,
    build_capture_snapshot,
    build_deferred_summary_payload,
    build_event,
    fallback_payload,
    get_capture_config,
    get_session_id,
    get_stop_summary_config,
    get_string_value,
    load_config,
    load_summary_state,
    persist_summary,
    read_transcript_excerpt,
    save_summary_state,
)


def spawn_worker(repo_root: Path, event: dict[str, object]) -> int:
    log_path = repo_root / TEAMAI_DIR / "logs" / "session-end.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)

    event_id = str(event.get("eventId", "event"))
    event_path = (
        repo_root / TEAMAI_DIR / "state" / "session-events" / f"{event_id}.json"
    )
    write_json(event_path, event)

    cmd = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--worker",
        "--event-file",
        str(event_path),
    ]
    env = os.environ.copy()
    env["TEAMAI_SESSION_END_WORKER"] = "1"

    with log_path.open("a", encoding="utf-8") as log_file:
        kwargs: dict[str, object] = {
            "cwd": str(repo_root),
            "stdin": subprocess.DEVNULL,
            "stdout": log_file,
            "stderr": log_file,
            "env": env,
        }

        if os.name == "nt":
            kwargs["creationflags"] = (
                subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            )
        else:
            kwargs["start_new_session"] = True

        try:
            subprocess.Popen(cmd, **kwargs)
        except OSError as error:
            log_file.write(f"Failed to spawn session-end worker: {error}\n")
            return 1

    return 0


def process_event(repo_root: Path, event: dict[str, object]) -> int:
    config = load_config(repo_root)
    stop_config = get_stop_summary_config(config)
    capture_config = get_capture_config(config)
    session_id = get_session_id(event)
    state = load_summary_state(repo_root)

    completed_requests = [
        request
        for request in state.get("requests", {}).values()
        if isinstance(request, dict)
        and str(request.get("sessionId")) == session_id
        and str(request.get("status")) == "completed"
    ]
    unresolved_requests = [
        request
        for request in state.get("requests", {}).values()
        if isinstance(request, dict)
        and str(request.get("sessionId")) == session_id
        and str(request.get("status")) in {"pending", "running", "failed"}
    ]

    if completed_requests:
        requests = state.get("requests", {})
        if isinstance(requests, dict):
            for request in unresolved_requests:
                request["status"] = "expired"
                request["updatedAt"] = str(event.get("createdAt"))
                request["fallbackEventId"] = str(event.get("eventId"))
        save_summary_state(repo_root, state)
        return 0

    requests = state.get("requests", {})
    latest_request = unresolved_requests[0] if unresolved_requests else None
    if latest_request and isinstance(requests, dict):
        request_event_value = latest_request.get("event")
        request_event = request_event_value if isinstance(request_event_value, dict) else {}
        deferred_event = dict(request_event) if request_event else dict(event)
        for key in (
            "transcriptPath",
            "reason",
            "repoRoot",
            "worktreeFiles",
            "worktreeDiff",
            "worktreeCapturedAt",
        ):
            if key not in deferred_event and key in event:
                deferred_event[key] = event[key]

        transcript_path = get_string_value(deferred_event, "transcriptPath")
        transcript_text = read_transcript_excerpt(
            transcript_path,
            int(capture_config["maxTranscriptChars"]),
        )
        files_value = deferred_event.get("worktreeFiles")
        files = (
            [item for item in files_value if isinstance(item, str) and item]
            if isinstance(files_value, list)
            else []
        )
        if not files:
            files = build_capture_snapshot(repo_root, capture_config).get("worktreeFiles", [])
            if not isinstance(files, list):
                files = []

        payload = build_deferred_summary_payload(latest_request, transcript_text, files)
        evidence = persist_summary(
            repo_root,
            deferred_event,
            payload,
            "session-end-deferred",
            {
                "sessionEndDeferred": True,
                "sessionEndEventId": event.get("eventId"),
                "summaryRequestId": latest_request.get("requestId"),
                "stopSummaryAgent": stop_config["agentName"],
                "assistantExcerptChars": len(
                    str(latest_request.get("assistantMessageExcerpt", "")).strip()
                ),
            },
        )

        completed_at = str(event.get("createdAt")) or str(evidence.get("createdAt"))
        for request in unresolved_requests:
            request["updatedAt"] = completed_at
            if request is latest_request:
                request["status"] = "completed"
                request["completedAt"] = completed_at
                request["evidenceEventId"] = evidence.get("eventId")
                request["completionMode"] = "session-end-deferred"
            else:
                request["status"] = "expired"
                request["fallbackEventId"] = str(event.get("eventId"))
        save_summary_state(repo_root, state)
        return 0

    files_value = event.get("worktreeFiles")
    files = [item for item in files_value if isinstance(item, str) and item] if isinstance(files_value, list) else []
    if not files:
        files = build_capture_snapshot(repo_root, capture_config).get("worktreeFiles", [])
        if not isinstance(files, list):
            files = []
    payload = fallback_payload(event, files)
    persist_summary(
        repo_root,
        event,
        payload,
        "session-end-fallback",
        {
            "sessionEndFallback": True,
            "stopSummaryAgent": stop_config["agentName"],
        },
    )

    if isinstance(requests, dict):
        for request in unresolved_requests:
            request["status"] = "expired"
            request["updatedAt"] = str(event.get("createdAt"))
            request["fallbackEventId"] = str(event.get("eventId"))
    save_summary_state(repo_root, state)
    return 0


def main() -> int:
    configure_stdout()

    parser = argparse.ArgumentParser(description="TeamAI session-end fallback recorder")
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--event-file")
    args = parser.parse_args()

    if args.worker:
        if not args.event_file:
            return 1

        event_path = Path(args.event_file)
        event = read_json(event_path)
        if not event:
            return 1

        repo_root_value = event.get("repoRoot", "")
        repo_root = (
            find_repo_root(Path(repo_root_value))
            if isinstance(repo_root_value, str) and repo_root_value
            else find_repo_root()
        )
        result = process_event(repo_root, event)
        if result == 0:
            try:
                event_path.unlink()
            except OSError:
                pass
        return result

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
    capture_config = get_capture_config(config)
    snapshot = build_capture_snapshot(repo_root, capture_config)
    event = build_event(
        input_data,
        repo_root,
        event_kind="session_end_fallback",
        snapshot=snapshot,
    )
    return spawn_worker(repo_root, event)


if __name__ == "__main__":
    sys.exit(main())
