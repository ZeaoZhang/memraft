#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from common import (
    TEAMAI_DIR,
    fingerprint_text,
    normalize_text,
    read_json,
    tail_text,
    write_json,
    write_text,
)

GRADE_ORDER = {"D": 0, "C": 1, "B": 2, "A": 3}
SUMMARY_AGENT_NAME = "teamai-memory-summarizer"
DEFAULT_PROMOTION_RULES = {
    "minimumOccurrences": 2,
    "minimumEvidenceCount": 2,
    "minimumConfidence": 0.68,
}
DEFAULT_CAPTURE_CONFIG = {
    "excludePathPrefixes": [
        f"{TEAMAI_DIR}/",
        ".omc/",
        ".claude/",
        ".git/",
    ],
    "maxTranscriptChars": 18000,
    "maxDiffChars": 14000,
}
DEFAULT_STOP_SUMMARY_CONFIG = {
    "enabled": True,
    "agentName": SUMMARY_AGENT_NAME,
    "minimumAssistantChars": 450,
    "minimumChangedFiles": 1,
    "allowWithoutChanges": True,
    "maxBlockAttempts": 2,
    "maxReasonChars": 2400,
    "maxAssistantExcerptChars": 2400,
    "maxFilesInReason": 12,
}
COMPILE_STATE_VERSION = 1
MAX_COMPILE_CACHE_RECENT_FILES = 8
DEFERRED_SPEC_KEYWORDS = (
    "should",
    "must",
    "always",
    "never",
    "keep",
    "use",
    "prefer",
    "avoid",
    "return",
    "only",
    "do not",
)
DEFERRED_KNOWLEDGE_HINTS = (
    " is ",
    " are ",
    " uses ",
    " contains ",
    " stores ",
    " reads ",
    " writes ",
    " handles ",
    " runs ",
    " part of ",
)
FILE_PATH_PATTERN = re.compile(r"(?:^|[\s`\"'])((?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+)")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def compact_timestamp(iso_value: str) -> str:
    return iso_value.replace("-", "").replace(":", "")


def run_command(
    cmd: list[str],
    cwd: Path,
    timeout: int = 30,
    env: dict[str, str] | None = None,
) -> tuple[int, str, str]:
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        return 1, "", str(error)

    return result.returncode, result.stdout, result.stderr


def hash_json_payload(data: object) -> str:
    payload = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def get_string_value(data: dict[str, object], *keys: str) -> str:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def get_bool_value(data: dict[str, object], *keys: str) -> bool:
    for key in keys:
        value = data.get(key)
        if isinstance(value, bool):
            return value
    return False


def get_session_id(input_data: dict[str, object]) -> str:
    value = get_string_value(input_data, "session_id", "sessionId")
    return value or "unknown-session"


def get_transcript_path(input_data: dict[str, object]) -> str:
    value = get_string_value(input_data, "transcript_path", "transcriptPath")
    if not value:
        return ""
    return str(Path(value).expanduser())


def get_reason(input_data: dict[str, object], fallback: str) -> str:
    value = get_string_value(input_data, "reason", "sessionReason")
    return value or fallback


def get_last_assistant_message(input_data: dict[str, object]) -> str:
    return get_string_value(
        input_data,
        "last_assistant_message",
        "lastAssistantMessage",
        "assistant_message",
        "assistantMessage",
    )


def get_agent_type(input_data: dict[str, object]) -> str:
    return get_string_value(
        input_data,
        "subagent_type",
        "subagentType",
        "agent_type",
        "agentType",
    )


def get_agent_id(input_data: dict[str, object]) -> str:
    return get_string_value(
        input_data,
        "subagent_id",
        "subagentId",
        "agent_id",
        "agentId",
    )


def get_stop_hook_active(input_data: dict[str, object]) -> bool:
    return get_bool_value(input_data, "stop_hook_active", "stopHookActive")


def build_event(
    input_data: dict[str, object],
    repo_root: Path,
    *,
    event_kind: str,
    message_fingerprint: str = "",
    snapshot: dict[str, object] | None = None,
) -> dict[str, object]:
    created_at = now_iso()
    session_id = get_session_id(input_data)
    transcript_path = get_transcript_path(input_data)
    event_seed = "|".join(
        [
            event_kind,
            session_id,
            message_fingerprint or "no-message",
            created_at,
        ]
    )
    event_id = f"{compact_timestamp(created_at)}_{fingerprint_text(event_seed)[:8]}"

    event = {
        "eventId": event_id,
        "eventKind": event_kind,
        "createdAt": created_at,
        "sessionId": session_id,
        "reason": get_reason(input_data, event_kind),
        "transcriptPath": transcript_path,
        "repoRoot": str(repo_root),
    }
    if isinstance(snapshot, dict):
        worktree_files = snapshot.get("worktreeFiles")
        if isinstance(worktree_files, list):
            event["worktreeFiles"] = [
                item for item in worktree_files if isinstance(item, str) and item
            ]
        worktree_diff = snapshot.get("worktreeDiff")
        if isinstance(worktree_diff, str):
            event["worktreeDiff"] = worktree_diff
        captured_at = snapshot.get("capturedAt")
        if isinstance(captured_at, str) and captured_at:
            event["worktreeCapturedAt"] = captured_at
    return event


def load_config(repo_root: Path) -> dict[str, object]:
    config = read_json(repo_root / TEAMAI_DIR / "config.json")
    return config or {}


def get_compiled_state_path(repo_root: Path) -> Path:
    return repo_root / TEAMAI_DIR / "state" / "compiled-state.json"


def load_compiled_state(repo_root: Path) -> dict[str, object]:
    state = read_json(get_compiled_state_path(repo_root))
    if not state:
        return {}
    return state


def get_capture_config(config: dict[str, object]) -> dict[str, object]:
    capture = config.get("capture", {})
    next_config = dict(DEFAULT_CAPTURE_CONFIG)
    if not isinstance(capture, dict):
        return next_config

    exclude_prefixes = capture.get("excludePathPrefixes")
    if isinstance(exclude_prefixes, list):
        cleaned_prefixes: list[str] = []
        seen = set()
        for item in exclude_prefixes:
            if not isinstance(item, str):
                continue
            normalized = item.strip().replace("\\", "/").lstrip("./")
            if not normalized:
                continue
            if not normalized.endswith("/"):
                normalized = f"{normalized}/"
            if normalized in seen:
                continue
            seen.add(normalized)
            cleaned_prefixes.append(normalized)
        if cleaned_prefixes:
            next_config["excludePathPrefixes"] = cleaned_prefixes

    for key in ("maxTranscriptChars", "maxDiffChars"):
        value = capture.get(key)
        if isinstance(value, int) and value > 0:
            next_config[key] = value

    return next_config


def get_stop_summary_config(config: dict[str, object]) -> dict[str, object]:
    stop_summary = config.get("stopSummary", {})
    next_config = dict(DEFAULT_STOP_SUMMARY_CONFIG)
    if not isinstance(stop_summary, dict):
        return next_config

    enabled = stop_summary.get("enabled")
    if isinstance(enabled, bool):
        next_config["enabled"] = enabled

    for key in (
        "minimumAssistantChars",
        "minimumChangedFiles",
        "maxBlockAttempts",
        "maxReasonChars",
        "maxAssistantExcerptChars",
        "maxFilesInReason",
    ):
        value = stop_summary.get(key)
        if isinstance(value, int) and value > 0:
            next_config[key] = value

    allow_without_changes = stop_summary.get("allowWithoutChanges")
    if isinstance(allow_without_changes, bool):
        next_config["allowWithoutChanges"] = allow_without_changes

    return next_config


def get_promotion_rules(config: dict[str, object]) -> dict[str, object]:
    rules = dict(DEFAULT_PROMOTION_RULES)
    merge = config.get("merge", {})
    if not isinstance(merge, dict):
        return rules

    promotion = merge.get("promotion", {})
    if not isinstance(promotion, dict):
        return rules

    minimum_occurrences = promotion.get("minimumOccurrences")
    minimum_evidence = promotion.get("minimumEvidenceCount")
    minimum_confidence = promotion.get("minimumConfidence")

    if isinstance(minimum_occurrences, int) and minimum_occurrences > 0:
        rules["minimumOccurrences"] = minimum_occurrences
    if isinstance(minimum_evidence, int) and minimum_evidence > 0:
        rules["minimumEvidenceCount"] = minimum_evidence
    if isinstance(minimum_confidence, (int, float)):
        bounded_confidence = max(0.0, min(float(minimum_confidence), 1.0))
        rules["minimumConfidence"] = round(bounded_confidence, 2)

    return rules


def resolve_teamai_path(
    repo_root: Path,
    relative_path: str,
    *,
    label: str,
) -> Path:
    teamai_root = (repo_root / TEAMAI_DIR).resolve()
    candidate = (teamai_root / relative_path).resolve()

    try:
        candidate.relative_to(teamai_root)
    except ValueError as error:
        raise ValueError(
            f"{label} must stay within {TEAMAI_DIR}/ (received: {relative_path})"
        ) from error

    return candidate


def get_artifact_path(
    repo_root: Path,
    config: dict[str, object],
    key: str,
    fallback: str,
) -> Path:
    artifacts = config.get("artifacts", {})
    if isinstance(artifacts, dict):
        raw_value = artifacts.get(key, fallback)
        if isinstance(raw_value, str) and raw_value:
            return resolve_teamai_path(
                repo_root,
                raw_value,
                label=f"artifacts.{key}",
            )
    return resolve_teamai_path(repo_root, fallback, label=f"artifacts.{key}")


def read_artifact_json(
    repo_root: Path,
    config: dict[str, object],
    key: str,
    fallback: str,
) -> dict[str, object]:
    return read_json(get_artifact_path(repo_root, config, key, fallback)) or {}


def get_compile_output_paths(repo_root: Path, config: dict[str, object]) -> dict[str, Path]:
    return {
        "repoProfile": get_artifact_path(
            repo_root,
            config,
            "repoProfilePath",
            "state/repo-profile.json",
        ),
        "ruleStore": get_artifact_path(
            repo_root,
            config,
            "ruleStorePath",
            "state/rule-store.json",
        ),
        "compiledSpec": get_artifact_path(
            repo_root,
            config,
            "compiledSpecPath",
            "generated/spec.md",
        ),
        "sessionStartInjection": get_artifact_path(
            repo_root,
            config,
            "sessionStartInjectionPath",
            "generated/inject/session-start.txt",
        ),
        "toolInjection": get_artifact_path(
            repo_root,
            config,
            "toolInjectionPath",
            "generated/inject/tool-task.txt",
        ),
        "subagentInjection": get_artifact_path(
            repo_root,
            config,
            "subagentInjectionPath",
            "generated/inject/subagent.txt",
        ),
    }


def compile_outputs_exist(paths: dict[str, Path]) -> bool:
    return all(path.is_file() for path in paths.values())


def unique_strings(values: list[str]) -> list[str]:
    seen = set()
    ordered: list[str] = []
    for value in values:
        cleaned = value.strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        ordered.append(cleaned)
    return ordered


def collect_package_names(package_json: dict[str, object]) -> set[str]:
    packages: set[str] = set()
    for key in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        value = package_json.get(key)
        if not isinstance(value, dict):
            continue
        for package_name in value.keys():
            if isinstance(package_name, str) and package_name:
                packages.add(package_name)
    return packages


def detect_package_managers(repo_root: Path, package_json: dict[str, object]) -> list[str]:
    detected: list[str] = []
    package_manager = get_string_value(package_json, "packageManager")
    if package_manager:
        detected.append(package_manager.split("@", 1)[0])

    lockfiles = [
        ("bun", "bun.lock"),
        ("bun", "bun.lockb"),
        ("pnpm", "pnpm-lock.yaml"),
        ("yarn", "yarn.lock"),
        ("npm", "package-lock.json"),
    ]
    for manager, filename in lockfiles:
        if (repo_root / filename).is_file():
            detected.append(manager)

    return unique_strings(detected)


def infer_workspace_type(repo_root: Path, package_json: dict[str, object]) -> str:
    if (repo_root / "pnpm-workspace.yaml").is_file():
        return "monorepo"

    workspaces = package_json.get("workspaces")
    if isinstance(workspaces, list) and workspaces:
        return "monorepo"
    if isinstance(workspaces, dict) and workspaces:
        return "monorepo"

    if (repo_root / "turbo.json").is_file() or (repo_root / "nx.json").is_file():
        return "monorepo"

    return "single-package"


def infer_repo_languages(repo_root: Path, package_json: dict[str, object], package_names: set[str]) -> list[str]:
    languages: list[str] = []
    if package_json:
        languages.append("javascript")

    if (
        (repo_root / "tsconfig.json").is_file()
        or "typescript" in package_names
        or any(path.suffix in {".ts", ".tsx"} for path in repo_root.glob("src/*"))
    ):
        languages.append("typescript")

    if (repo_root / "pyproject.toml").is_file() or (repo_root / "requirements.txt").is_file():
        languages.append("python")

    if (repo_root / "Cargo.toml").is_file():
        languages.append("rust")

    if (repo_root / "go.mod").is_file():
        languages.append("go")

    return unique_strings(languages)


def infer_frameworks(package_names: set[str]) -> list[str]:
    detected: list[str] = []
    mapping = {
        "next": "Next.js",
        "react": "React",
        "vue": "Vue",
        "svelte": "Svelte",
        "astro": "Astro",
        "express": "Express",
        "fastify": "Fastify",
        "@nestjs/core": "NestJS",
    }
    for package_name, label in mapping.items():
        if package_name in package_names:
            detected.append(label)
    return unique_strings(detected)


def infer_tooling(repo_root: Path, package_names: set[str], workspace_type: str) -> list[str]:
    tooling: list[str] = []
    file_markers = [
        ("tsconfig.json", "TypeScript"),
        ("biome.json", "Biome"),
        (".prettierrc", "Prettier"),
        ("prettier.config.js", "Prettier"),
        ("eslint.config.js", "ESLint"),
        (".eslintrc", "ESLint"),
        ("vitest.config.ts", "Vitest"),
        ("jest.config.js", "Jest"),
        ("playwright.config.ts", "Playwright"),
        ("turbo.json", "Turborepo"),
        ("nx.json", "Nx"),
    ]
    for filename, label in file_markers:
        if (repo_root / filename).is_file():
            tooling.append(label)

    dependency_markers = {
        "typescript": "TypeScript",
        "eslint": "ESLint",
        "prettier": "Prettier",
        "vitest": "Vitest",
        "jest": "Jest",
        "@playwright/test": "Playwright",
        "turbo": "Turborepo",
        "nx": "Nx",
    }
    for package_name, label in dependency_markers.items():
        if package_name in package_names:
            tooling.append(label)

    if workspace_type == "monorepo":
        tooling.append("Workspace orchestration")

    return unique_strings(tooling)


def infer_commands(package_json: dict[str, object], package_managers: list[str]) -> dict[str, str]:
    scripts = package_json.get("scripts")
    commands: dict[str, str] = {}
    if isinstance(scripts, dict):
        for key in ("dev", "start", "build", "test", "lint", "typecheck", "check", "format"):
            value = scripts.get(key)
            if isinstance(value, str) and value.strip():
                commands[key] = value.strip()

    if package_managers:
        manager = package_managers[0]
        install_commands = {
            "bun": "bun install",
            "pnpm": "pnpm install",
            "yarn": "yarn install",
            "npm": "npm install",
        }
        install_command = install_commands.get(manager)
        if install_command:
            commands.setdefault("install", install_command)

    return commands


def scan_repo_profile(repo_root: Path, config: dict[str, object]) -> dict[str, object]:
    package_json = read_json(repo_root / "package.json") or {}
    package_names = collect_package_names(package_json)
    package_managers = detect_package_managers(repo_root, package_json)
    workspace_type = infer_workspace_type(repo_root, package_json)
    commands = infer_commands(package_json, package_managers)

    project_name = get_string_value(config, "projectName") or repo_root.name or "repo"
    return {
        "version": 1,
        "projectName": project_name,
        "repoRoot": str(repo_root),
        "scannedAt": now_iso(),
        "workspaceType": workspace_type,
        "languages": infer_repo_languages(repo_root, package_json, package_names),
        "packageManagers": package_managers,
        "frameworks": infer_frameworks(package_names),
        "tooling": infer_tooling(repo_root, package_names, workspace_type),
        "commands": commands,
    }


def stabilize_repo_profile(
    repo_root: Path,
    config: dict[str, object],
    repo_profile: dict[str, object],
) -> dict[str, object]:
    existing = read_artifact_json(
        repo_root,
        config,
        "repoProfilePath",
        "state/repo-profile.json",
    )
    if not existing:
        return repo_profile

    existing_compare = dict(existing)
    next_compare = dict(repo_profile)
    existing_compare.pop("scannedAt", None)
    next_compare.pop("scannedAt", None)
    if existing_compare == next_compare:
        return existing
    return repo_profile


def get_session_evidence_path(repo_root: Path, event_id: str) -> Path:
    return repo_root / TEAMAI_DIR / "evidence" / "sessions" / f"{event_id}.json"


def was_processed(repo_root: Path, event_id: str) -> bool:
    return get_session_evidence_path(repo_root, event_id).exists()


def is_excluded_path(path_value: str, excluded_prefixes: list[str]) -> bool:
    normalized = path_value.strip().replace("\\", "/").lstrip("./")
    if not normalized:
        return False

    for prefix in excluded_prefixes:
        clean_prefix = prefix.rstrip("/")
        if normalized == clean_prefix or normalized.startswith(prefix):
            return True

    return False


def get_worktree_files(repo_root: Path, excluded_prefixes: list[str]) -> list[str]:
    code, stdout, _stderr = run_command(
        ["git", "status", "--short", "--untracked-files=all"],
        repo_root,
    )
    if code != 0:
        return []

    files: list[str] = []
    seen = set()
    for line in stdout.splitlines():
        if len(line) < 4:
            continue
        file_part = line[3:].strip()
        if " -> " in file_part:
            file_part = file_part.split(" -> ", 1)[1]
        file_part = file_part.strip('"')
        if is_excluded_path(file_part, excluded_prefixes):
            continue
        if file_part and file_part not in seen:
            seen.add(file_part)
            files.append(file_part)
    return files


def get_untracked_worktree_files(
    repo_root: Path,
    excluded_prefixes: list[str],
) -> list[str]:
    code, stdout, _stderr = run_command(
        ["git", "ls-files", "--others", "--exclude-standard", "--", "."],
        repo_root,
    )
    if code != 0:
        return []

    files: list[str] = []
    seen = set()
    for line in stdout.splitlines():
        file_path = line.strip().strip('"')
        if not file_path or file_path in seen:
            continue
        if is_excluded_path(file_path, excluded_prefixes):
            continue
        seen.add(file_path)
        files.append(file_path)
    return files


def build_diff_command(base_command: list[str], excluded_prefixes: list[str]) -> list[str]:
    command = [*base_command, "--", "."]
    for prefix in excluded_prefixes:
        command.append(f":(exclude){prefix.rstrip('/')}/**")
    return command


def get_worktree_diff(
    repo_root: Path,
    max_chars: int,
    excluded_prefixes: list[str],
) -> str:
    segments: list[str] = []
    commands = [
        build_diff_command(
            ["git", "diff", "--stat", "--unified=0", "--no-ext-diff"],
            excluded_prefixes,
        ),
        build_diff_command(
            ["git", "diff", "--cached", "--stat", "--unified=0", "--no-ext-diff"],
            excluded_prefixes,
        ),
    ]
    for command in commands:
        code, stdout, _stderr = run_command(command, repo_root, timeout=60)
        if code == 0 and stdout.strip():
            segments.append(f"$ {' '.join(command)}\n{stdout.strip()}")

    untracked_files = get_untracked_worktree_files(repo_root, excluded_prefixes)
    if untracked_files:
        lines = [
            "$ git ls-files --others --exclude-standard -- .",
            *[
                f"?? {file_path} ({(repo_root / file_path).stat().st_size} bytes)"
                if (repo_root / file_path).exists()
                else f"?? {file_path}"
                for file_path in untracked_files[:20]
            ],
        ]
        if len(untracked_files) > 20:
            lines.append(f"... {len(untracked_files) - 20} more untracked files")
        segments.append("\n".join(lines))

    combined = "\n\n".join(segments)
    return combined[:max_chars]


def build_capture_snapshot(
    repo_root: Path,
    capture_config: dict[str, object],
) -> dict[str, object]:
    excluded_prefixes = capture_config.get("excludePathPrefixes", [])
    if not isinstance(excluded_prefixes, list):
        excluded_prefixes = list(DEFAULT_CAPTURE_CONFIG["excludePathPrefixes"])

    max_diff_chars = capture_config.get(
        "maxDiffChars",
        DEFAULT_CAPTURE_CONFIG["maxDiffChars"],
    )
    if not isinstance(max_diff_chars, int) or max_diff_chars <= 0:
        max_diff_chars = int(DEFAULT_CAPTURE_CONFIG["maxDiffChars"])

    return {
        "capturedAt": now_iso(),
        "worktreeFiles": get_worktree_files(repo_root, excluded_prefixes),
        "worktreeDiff": get_worktree_diff(repo_root, max_diff_chars, excluded_prefixes),
    }


def read_transcript_excerpt(path_value: str, max_chars: int) -> str:
    if not path_value:
        return ""
    return tail_text(Path(path_value), max_chars)


def extract_json(text: str) -> dict[str, object] | None:
    text = text.strip()
    if not text:
        return None

    candidates = [text]
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last >= first:
        candidates.append(text[first : last + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def clean_bullets(value: object) -> list[str]:
    if not isinstance(value, list):
        return []

    cleaned_items: list[str] = []
    seen = set()
    for item in value:
        if not isinstance(item, str):
            continue
        cleaned = item.strip().lstrip("-* ").strip()
        normalized = normalize_text(cleaned)
        if not cleaned or not normalized or normalized in seen:
            continue
        seen.add(normalized)
        cleaned_items.append(cleaned)
    return cleaned_items


def split_deferred_sentences(text: str) -> list[str]:
    if not text.strip():
        return []

    collapsed = re.sub(r"\s+", " ", text.strip())
    parts = re.split(r"(?<=[.!?])\s+", collapsed)
    sentences: list[str] = []
    for part in parts:
        cleaned = part.strip().strip("-* ").strip()
        if len(cleaned) < 24:
            continue
        if len(cleaned) > 240:
            cleaned = cleaned[:237].rstrip() + "..."
        sentences.append(cleaned)
    return sentences


def extract_deferred_candidate_spec(text_sources: list[str]) -> list[str]:
    candidates: list[str] = []
    for text in text_sources:
        for sentence in split_deferred_sentences(text):
            normalized = normalize_text(sentence)
            if any(keyword in normalized for keyword in DEFERRED_SPEC_KEYWORDS):
                candidates.append(sentence)
    return clean_bullets(candidates)[:4]


def extract_deferred_knowledge(text_sources: list[str]) -> list[str]:
    candidates: list[str] = []
    for text in text_sources:
        for sentence in split_deferred_sentences(text):
            normalized = f" {normalize_text(sentence)} "
            if not any(hint in normalized for hint in DEFERRED_KNOWLEDGE_HINTS):
                continue
            if FILE_PATH_PATTERN.search(sentence):
                candidates.append(sentence)
    return clean_bullets(candidates)[:4]


def summarize_deferred_context(
    assistant_excerpt: str,
    transcript_text: str,
    files: list[str],
) -> str:
    for source_text in (assistant_excerpt, transcript_text):
        for sentence in split_deferred_sentences(source_text):
            return f"Deferred TeamAI summary captured after session end. {sentence}"

    summary = "Deferred TeamAI summary captured after session end."
    if files:
        summary = f"{summary} Files touched: {', '.join(files[:5])}."
    return summary


def build_deferred_summary_payload(
    request: dict[str, object],
    transcript_text: str,
    files: list[str],
) -> dict[str, object]:
    assistant_excerpt = get_string_value(request, "assistantMessageExcerpt")
    sources = [assistant_excerpt, transcript_text]
    knowledge = extract_deferred_knowledge(sources)
    candidate_spec = extract_deferred_candidate_spec(sources)
    return {
        "summary": summarize_deferred_context(assistant_excerpt, transcript_text, files),
        "knowledge": knowledge,
        "candidate_spec": candidate_spec,
    }


def fallback_payload(event: dict[str, object], files: list[str]) -> dict[str, object]:
    summary = "Session ended without a completed TeamAI subagent summary."
    event_kind = get_string_value(event, "eventKind")
    if event_kind == "session_end_fallback":
        summary = "Session ended before a completed TeamAI subagent summary was captured."
    if files:
        summary = f"{summary} Files touched: {', '.join(files[:5])}."
    return {
        "summary": summary,
        "knowledge": [],
        "candidate_spec": [],
    }


def score_quality(
    transcript_text: str,
    diff_text: str,
    files: list[str],
    generator: str,
    summary: str,
    knowledge: list[str],
    candidate_spec: list[str],
) -> dict[str, object]:
    score = 0
    signals: list[str] = []

    transcript_chars = len(transcript_text.strip())
    if transcript_chars >= 1500:
        score += 25
        signals.append("transcript")
    elif transcript_chars > 0:
        score += 12
        signals.append("transcript")

    diff_chars = len(diff_text.strip())
    if diff_chars >= 1000:
        score += 20
        signals.append("diff")
    elif diff_chars > 0:
        score += 10
        signals.append("diff")

    if files:
        score += min(15, 5 + len(files) * 2)
        signals.append("files")

    if generator.endswith("fallback"):
        signals.append("fallback")
    else:
        score += 20
        signals.append("model_summary")

    if summary:
        score += 10
        signals.append("summary")

    extracted_count = len(knowledge) + len(candidate_spec)
    if extracted_count > 0:
        score += min(20, extracted_count * 5)
        signals.append("extracted_items")

    score = min(score, 100)
    if score >= 85:
        grade = "A"
    elif score >= 70:
        grade = "B"
    elif score >= 55:
        grade = "C"
    else:
        grade = "D"

    return {
        "grade": grade,
        "score": score,
        "signals": signals,
        "transcriptChars": transcript_chars,
        "diffChars": diff_chars,
        "fileCount": len(files),
    }


def grade_rank(grade: str) -> int:
    return GRADE_ORDER.get(grade, 0)


def merge_allowed(
    quality: dict[str, object],
    config: dict[str, object],
) -> tuple[bool, str]:
    merge = config.get("merge", {})
    minimum_grade = "C"
    if isinstance(merge, dict):
        raw_minimum = merge.get("minimumGrade", "C")
        if isinstance(raw_minimum, str) and raw_minimum:
            minimum_grade = raw_minimum.upper()

    grade_value = quality.get("grade", "D")
    grade = grade_value if isinstance(grade_value, str) else "D"
    return grade_rank(grade) >= grade_rank(minimum_grade), minimum_grade


def calculate_confidence(average_score: int, evidence_count: int) -> float:
    bounded_score = max(0, min(average_score, 100))
    bounded_evidence = max(0, evidence_count)
    quality_component = bounded_score / 100
    support_component = min(bounded_evidence, 4) / 4
    confidence = quality_component * 0.65 + support_component * 0.35
    return round(min(confidence, 1.0), 2)


def update_promotion_status(
    record: dict[str, object],
    promotion_rules: dict[str, object],
    created_at: str,
) -> bool:
    occurrences_value = record.get("occurrences", 0)
    occurrences = occurrences_value if isinstance(occurrences_value, int) else 0
    evidence_count_value = record.get("evidenceCount", 0)
    evidence_count = (
        evidence_count_value if isinstance(evidence_count_value, int) else 0
    )
    confidence_value = record.get("confidence", 0.0)
    confidence = (
        float(confidence_value)
        if isinstance(confidence_value, (int, float))
        else 0.0
    )

    minimum_occurrences_value = promotion_rules.get("minimumOccurrences", 2)
    minimum_occurrences = (
        minimum_occurrences_value if isinstance(minimum_occurrences_value, int) else 2
    )
    minimum_evidence_value = promotion_rules.get("minimumEvidenceCount", 2)
    minimum_evidence = (
        minimum_evidence_value if isinstance(minimum_evidence_value, int) else 2
    )
    minimum_confidence_value = promotion_rules.get("minimumConfidence", 0.68)
    minimum_confidence = (
        float(minimum_confidence_value)
        if isinstance(minimum_confidence_value, (int, float))
        else 0.68
    )

    qualifies = (
        occurrences >= minimum_occurrences
        and evidence_count >= minimum_evidence
        and confidence >= minimum_confidence
    )
    previous_status_value = record.get("promotionStatus", "candidate")
    previous_status = (
        previous_status_value if isinstance(previous_status_value, str) else "candidate"
    )

    record["promotionStatus"] = "promoted" if qualifies else "candidate"
    if qualifies:
        first_promoted_at_value = record.get("firstPromotedAt", "")
        if (
            not isinstance(first_promoted_at_value, str)
            or not first_promoted_at_value
        ):
            record["firstPromotedAt"] = created_at

    return previous_status != "promoted" and qualifies


def load_merge_index(repo_root: Path) -> dict[str, object]:
    merge_index_path = repo_root / TEAMAI_DIR / "state" / "merge-index.json"
    data = read_json(merge_index_path)
    if not data:
        return {"knowledge": {}, "candidateSpec": {}}

    knowledge = data.get("knowledge")
    candidate_spec = data.get("candidateSpec")
    return {
        "knowledge": knowledge if isinstance(knowledge, dict) else {},
        "candidateSpec": candidate_spec if isinstance(candidate_spec, dict) else {},
    }


def coerce_record(value: object) -> dict[str, object] | None:
    return value if isinstance(value, dict) else None


def rank_records(records: dict[str, object]) -> list[dict[str, object]]:
    coerced_records = []
    for value in records.values():
        record = coerce_record(value)
        if record is not None:
            coerced_records.append(record)

    def sort_key(record: dict[str, object]) -> tuple[int, int, int, int, str]:
        confidence_value = record.get("confidence", 0.0)
        confidence = (
            float(confidence_value)
            if isinstance(confidence_value, (int, float))
            else 0.0
        )
        confidence_score = int(round(confidence * 100))
        best_score = record.get("bestScore", 0)
        score = best_score if isinstance(best_score, int) else 0
        occurrences_value = record.get("occurrences", 0)
        occurrences = occurrences_value if isinstance(occurrences_value, int) else 0
        last_seen_value = record.get("lastSeenAt", "")
        last_seen = last_seen_value if isinstance(last_seen_value, str) else ""
        last_seen_score = int("".join(ch for ch in last_seen if ch.isdigit()) or "0")
        text_value = record.get("text", "")
        text = text_value if isinstance(text_value, str) else ""
        return (-confidence_score, -score, -occurrences, -last_seen_score, text.lower())

    return sorted(coerced_records, key=sort_key)


def split_ranked_records(records: dict[str, object]) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    promoted_records: list[dict[str, object]] = []
    candidate_records: list[dict[str, object]] = []
    for record in rank_records(records):
        status_value = record.get("promotionStatus", "candidate")
        status = status_value if isinstance(status_value, str) else "candidate"
        if status == "promoted":
            promoted_records.append(record)
        else:
            candidate_records.append(record)
    return promoted_records, candidate_records


def summarize_record_groups(records: dict[str, object]) -> dict[str, int]:
    promoted_records, candidate_records = split_ranked_records(records)
    return {
        "promotedCount": len(promoted_records),
        "candidateCount": len(candidate_records),
    }


def format_record_line(record: dict[str, object], *, include_meta: bool) -> str:
    text_value = record.get("text", "")
    text = text_value if isinstance(text_value, str) else ""
    if not include_meta:
        return f"- {text}"

    grade_value = record.get("bestGrade", "D")
    grade = grade_value if isinstance(grade_value, str) else "D"
    score_value = record.get("bestScore", 0)
    score = score_value if isinstance(score_value, int) else 0
    occurrences_value = record.get("occurrences", 0)
    occurrences = occurrences_value if isinstance(occurrences_value, int) else 0
    confidence_value = record.get("confidence", 0.0)
    confidence = (
        float(confidence_value)
        if isinstance(confidence_value, (int, float))
        else 0.0
    )
    return f"- [{grade}|{score}|x{occurrences}|c{confidence:.2f}] {text}"


def render_profile_lines(repo_profile: dict[str, object], *, compact_commands: bool) -> list[str]:
    lines: list[str] = []
    project_name = get_string_value(repo_profile, "projectName")
    workspace_type = get_string_value(repo_profile, "workspaceType")
    languages = repo_profile.get("languages", [])
    package_managers = repo_profile.get("packageManagers", [])
    frameworks = repo_profile.get("frameworks", [])
    tooling = repo_profile.get("tooling", [])
    commands = repo_profile.get("commands", {})

    if project_name:
        lines.append(f"- Project: {project_name}")
    if workspace_type:
        lines.append(f"- Workspace: {workspace_type}")
    if isinstance(languages, list) and languages:
        lines.append(f"- Languages: {', '.join(str(item) for item in languages[:4])}")
    if isinstance(package_managers, list) and package_managers:
        lines.append(
            f"- Package managers: {', '.join(str(item) for item in package_managers[:3])}"
        )
    if isinstance(frameworks, list) and frameworks:
        lines.append(f"- Frameworks: {', '.join(str(item) for item in frameworks[:4])}")
    if isinstance(tooling, list) and tooling:
        lines.append(f"- Tooling: {', '.join(str(item) for item in tooling[:5])}")
    if isinstance(commands, dict) and commands:
        for key in ("install", "dev", "build", "test", "lint", "typecheck"):
            value = commands.get(key)
            if not isinstance(value, str) or not value.strip():
                continue
            rendered = value.strip()
            if compact_commands and len(rendered) > 88:
                rendered = f"{rendered[:85].rstrip()}..."
            lines.append(f"- {key}: {rendered}")

    return lines or ["- Repo profile has not been scanned yet."]


def render_promoted_lines(
    records: dict[str, object],
    *,
    include_meta: bool,
    limit: int,
    empty_message: str,
) -> list[str]:
    promoted_records, _candidate_records = split_ranked_records(records)
    if not promoted_records:
        return [empty_message]
    return [
        format_record_line(record, include_meta=include_meta)
        for record in promoted_records[:limit]
    ]


def render_recent_evidence_lines(
    latest_evidence: dict[str, object],
    *,
    include_files: bool,
    max_files: int,
) -> list[str]:
    lines: list[str] = []
    summary = get_string_value(latest_evidence, "summary")
    quality = latest_evidence.get("quality", {})
    grade = ""
    if isinstance(quality, dict):
        grade = get_string_value(quality, "grade")

    if summary:
        lines.append(summary)
    if grade:
        lines.append(f"Quality grade: {grade}")

    if include_files:
        files = latest_evidence.get("files", [])
        if isinstance(files, list):
            file_lines = [f"- {item}" for item in files[:max_files] if isinstance(item, str) and item]
            if file_lines:
                lines.extend(["Files touched:", *file_lines])

    return lines


def render_compiled_spec_markdown(
    repo_profile: dict[str, object],
    knowledge_records: dict[str, object],
    spec_records: dict[str, object],
) -> str:
    lines = [
        "# Compiled TeamAI Spec",
        "",
        "This file is compiled from repo facts plus promoted TeamAI rules.",
        "",
        "## Repository Background",
        "",
        *render_profile_lines(repo_profile, compact_commands=False),
        "",
        "## Stable Project Rules",
        "",
        *render_promoted_lines(
            spec_records,
            include_meta=True,
            limit=24,
            empty_message="- No promoted rules yet.",
        ),
        "",
        "## Stable Learned Knowledge",
        "",
        *render_promoted_lines(
            knowledge_records,
            include_meta=True,
            limit=24,
            empty_message="- No promoted knowledge yet.",
        ),
        "",
    ]
    return "\n".join(lines)


def render_session_start_injection(
    repo_profile: dict[str, object],
    latest_evidence: dict[str, object],
    knowledge_records: dict[str, object],
    spec_records: dict[str, object],
) -> str:
    lines = [
        "<teamai-context>",
        "Use this compiled TeamAI context when it helps.",
        "If repository code conflicts with a note below, trust the repository state.",
        "",
    ]

    recent_lines = render_recent_evidence_lines(
        latest_evidence,
        include_files=True,
        max_files=8,
    )
    if recent_lines:
        lines.extend(["## Recent Evidence", *recent_lines, ""])

    lines.extend(
        [
            "## Repository Background",
            *render_profile_lines(repo_profile, compact_commands=True),
            "",
            "## Stable Project Rules",
            *render_promoted_lines(
                spec_records,
                include_meta=False,
                limit=10,
                empty_message="- No promoted rules yet.",
            ),
            "",
            "## Stable Learned Knowledge",
            *render_promoted_lines(
                knowledge_records,
                include_meta=False,
                limit=10,
                empty_message="- No promoted knowledge yet.",
            ),
            "</teamai-context>",
        ]
    )
    return "\n".join(lines)


def render_shared_injection(
    repo_profile: dict[str, object],
    latest_evidence: dict[str, object],
    knowledge_records: dict[str, object],
    spec_records: dict[str, object],
) -> str:
    lines = [
        "Use the compiled TeamAI context below when useful.",
        "If repository code conflicts with a note below, trust the repository state.",
        "",
    ]

    recent_lines = render_recent_evidence_lines(
        latest_evidence,
        include_files=False,
        max_files=0,
    )
    if recent_lines:
        lines.extend(["Recent evidence:", *recent_lines, ""])

    lines.extend(
        [
            "Repository background:",
            *render_profile_lines(repo_profile, compact_commands=True),
            "",
            "Stable project rules:",
            *render_promoted_lines(
                spec_records,
                include_meta=False,
                limit=6,
                empty_message="- No promoted rules yet.",
            ),
            "",
            "Stable learned knowledge:",
            *render_promoted_lines(
                knowledge_records,
                include_meta=False,
                limit=6,
                empty_message="- No promoted knowledge yet.",
            ),
        ]
    )
    return "\n".join(lines)


def merge_collection(
    records: dict[str, object],
    bullets: list[str],
    created_at: str,
    event_id: str,
    quality: dict[str, object],
    promotion_rules: dict[str, object],
) -> tuple[dict[str, object], dict[str, int]]:
    stats = {
        "added": 0,
        "updated": 0,
        "skipped": 0,
        "promoted": 0,
        "currentPromoted": 0,
        "currentCandidates": 0,
    }
    score_value = quality.get("score", 0)
    score = score_value if isinstance(score_value, int) else 0
    grade_value = quality.get("grade", "D")
    grade = grade_value if isinstance(grade_value, str) else "D"

    for bullet in bullets:
        fingerprint = fingerprint_text(bullet)
        if not fingerprint:
            stats["skipped"] += 1
            continue

        record = coerce_record(records.get(fingerprint))
        if record is None:
            average_score = score
            confidence = calculate_confidence(average_score, 1)
            record = {
                "fingerprint": fingerprint,
                "text": bullet,
                "firstSeenAt": created_at,
                "lastSeenAt": created_at,
                "occurrences": 1,
                "evidenceCount": 1,
                "bestGrade": grade,
                "bestScore": score,
                "scoreSum": score,
                "averageScore": average_score,
                "confidence": confidence,
                "promotionStatus": "candidate",
                "firstPromotedAt": "",
                "latestEvidenceId": event_id,
            }
            if update_promotion_status(record, promotion_rules, created_at):
                stats["promoted"] += 1
            records[fingerprint] = record
            stats["added"] += 1
            continue

        record["lastSeenAt"] = created_at
        record["latestEvidenceId"] = event_id
        occurrences_value = record.get("occurrences", 0)
        occurrences = occurrences_value if isinstance(occurrences_value, int) else 0
        record["occurrences"] = occurrences + 1
        evidence_count_value = record.get("evidenceCount", 0)
        evidence_count = (
            evidence_count_value if isinstance(evidence_count_value, int) else 0
        )
        record["evidenceCount"] = evidence_count + 1
        score_sum_value = record.get("scoreSum", 0)
        score_sum = score_sum_value if isinstance(score_sum_value, int) else 0
        next_score_sum = score_sum + score
        next_evidence_count = record["evidenceCount"]
        record["scoreSum"] = next_score_sum
        record["averageScore"] = int(round(next_score_sum / next_evidence_count))
        average_score_value = record.get("averageScore", score)
        average_score = (
            average_score_value if isinstance(average_score_value, int) else score
        )
        record["confidence"] = calculate_confidence(average_score, next_evidence_count)

        existing_score_value = record.get("bestScore", 0)
        existing_score = (
            existing_score_value if isinstance(existing_score_value, int) else 0
        )
        existing_text_value = record.get("text", "")
        existing_text = existing_text_value if isinstance(existing_text_value, str) else ""

        should_replace = score > existing_score or (
            score == existing_score and len(bullet) > len(existing_text)
        )
        if should_replace:
            if bullet != existing_text:
                stats["updated"] += 1
            record["text"] = bullet
            record["bestScore"] = score
            record["bestGrade"] = grade
        else:
            stats["skipped"] += 1

        if update_promotion_status(record, promotion_rules, created_at):
            stats["promoted"] += 1

    for value in records.values():
        record = coerce_record(value)
        if record is None:
            continue
        status_value = record.get("promotionStatus", "candidate")
        status = status_value if isinstance(status_value, str) else "candidate"
        if status == "promoted":
            stats["currentPromoted"] += 1
        else:
            stats["currentCandidates"] += 1

    return records, stats


def render_collection_markdown(
    title: str,
    intro: str,
    records: dict[str, object],
    promotion_rules: dict[str, object],
) -> str:
    promoted_records, candidate_records = split_ranked_records(records)

    minimum_occurrences_value = promotion_rules.get("minimumOccurrences", 2)
    minimum_occurrences = (
        minimum_occurrences_value if isinstance(minimum_occurrences_value, int) else 2
    )
    minimum_evidence_value = promotion_rules.get("minimumEvidenceCount", 2)
    minimum_evidence = (
        minimum_evidence_value if isinstance(minimum_evidence_value, int) else 2
    )
    minimum_confidence_value = promotion_rules.get("minimumConfidence", 0.68)
    minimum_confidence = (
        float(minimum_confidence_value)
        if isinstance(minimum_confidence_value, (int, float))
        else 0.68
    )

    lines = [
        f"# {title}",
        "",
        intro,
        "",
        "## Promotion Rules",
        "",
        (
            f"- Promote after x{minimum_occurrences} repeated occurrences, "
            f"{minimum_evidence} evidence events, confidence >= {minimum_confidence:.2f}."
        ),
        "- Only promoted entries are injected back into Claude context.",
        "",
        "## Promoted Entries",
        "",
    ]

    def append_records(collection: list[dict[str, object]], empty_message: str) -> None:
        if not collection:
            lines.append(empty_message)
            return

        for record in collection:
            lines.append(format_record_line(record, include_meta=True))

    append_records(promoted_records, "- No promoted entries yet.")
    lines.extend(["", "## Candidate Queue", ""])
    append_records(candidate_records, "- No candidate entries yet.")

    return "\n".join(lines).strip() + "\n"


def write_merge_outputs(
    repo_root: Path,
    config: dict[str, object],
    merge_index: dict[str, object],
    promotion_rules: dict[str, object],
) -> None:
    merge_index_path = repo_root / TEAMAI_DIR / "state" / "merge-index.json"
    write_json(merge_index_path, merge_index)

    knowledge_records = merge_index.get("knowledge")
    candidate_records = merge_index.get("candidateSpec")
    knowledge_dict = knowledge_records if isinstance(knowledge_records, dict) else {}
    candidate_dict = candidate_records if isinstance(candidate_records, dict) else {}

    memory_path = get_artifact_path(
        repo_root,
        config,
        "memoryPath",
        "knowledge/memory.md",
    )
    candidate_spec_path = get_artifact_path(
        repo_root,
        config,
        "candidateSpecPath",
        "specs/candidate-spec.md",
    )

    write_text(
        memory_path,
        render_collection_markdown(
            "Shared Knowledge Memory",
            "This file is auto-generated from deduplicated session evidence.",
            knowledge_dict,
            promotion_rules,
        ),
    )
    write_text(
        candidate_spec_path,
        render_collection_markdown(
            "Candidate Spec Draft",
            "This file stores deduplicated candidate conventions, contracts, and workflows.",
            candidate_dict,
            promotion_rules,
        ),
    )


def build_compiled_state(
    config: dict[str, object],
    merge_index: dict[str, object],
    repo_profile: dict[str, object],
    latest_evidence: dict[str, object],
) -> dict[str, object]:
    knowledge_records = merge_index.get("knowledge")
    candidate_records = merge_index.get("candidateSpec")
    knowledge_dict = knowledge_records if isinstance(knowledge_records, dict) else {}
    candidate_dict = candidate_records if isinstance(candidate_records, dict) else {}
    recent_files = latest_evidence.get("files", [])
    if not isinstance(recent_files, list):
        recent_files = []

    source = latest_evidence.get("source", {})
    latest_source = source if isinstance(source, dict) else {}

    payload = {
        "version": COMPILE_STATE_VERSION,
        "repoProfile": repo_profile,
        "mergeIndex": merge_index,
        "config": config,
        "latestEvidence": {
            "eventId": latest_evidence.get("eventId"),
            "summary": latest_evidence.get("summary"),
            "generator": latest_evidence.get("generator"),
            "quality": latest_evidence.get("quality"),
            "files": recent_files[:MAX_COMPILE_CACHE_RECENT_FILES],
            "source": {
                "transcriptChars": latest_source.get("transcriptChars"),
                "diffChars": latest_source.get("diffChars"),
                "sessionEndDeferred": latest_source.get("sessionEndDeferred"),
                "sessionEndFallback": latest_source.get("sessionEndFallback"),
            },
        },
        "counts": {
            "knowledge": len(knowledge_dict),
            "candidateSpec": len(candidate_dict),
        },
    }
    return {
        "version": COMPILE_STATE_VERSION,
        "updatedAt": now_iso(),
        "inputHash": hash_json_payload(payload),
    }


def has_fresh_compiled_outputs(
    repo_root: Path,
    config: dict[str, object],
    compiled_state: dict[str, object],
    expected_hash: str,
) -> bool:
    input_hash = get_string_value(compiled_state, "inputHash")
    if not input_hash or input_hash != expected_hash:
        return False
    return compile_outputs_exist(get_compile_output_paths(repo_root, config))


def write_compiled_state(repo_root: Path, compiled_state: dict[str, object]) -> None:
    write_json(get_compiled_state_path(repo_root), compiled_state)


def write_compiled_outputs(
    repo_root: Path,
    config: dict[str, object],
    merge_index: dict[str, object],
    latest_evidence: dict[str, object] | None = None,
    repo_profile: dict[str, object] | None = None,
) -> None:
    knowledge_records = merge_index.get("knowledge")
    spec_records = merge_index.get("candidateSpec")
    knowledge_dict = knowledge_records if isinstance(knowledge_records, dict) else {}
    spec_dict = spec_records if isinstance(spec_records, dict) else {}
    next_repo_profile = (
        repo_profile if isinstance(repo_profile, dict) else scan_repo_profile(repo_root, config)
    )
    next_repo_profile = stabilize_repo_profile(repo_root, config, next_repo_profile)

    rule_store = {
        "version": 1,
        "updatedAt": now_iso(),
        "repoProfile": next_repo_profile,
        "collections": {
            "knowledge": {
                **summarize_record_groups(knowledge_dict),
                "records": knowledge_dict,
            },
            "spec": {
                **summarize_record_groups(spec_dict),
                "records": spec_dict,
            },
        },
    }

    latest = latest_evidence if isinstance(latest_evidence, dict) else read_artifact_json(
        repo_root,
        config,
        "latestEvidencePath",
        "evidence/latest.json",
    )

    compiled_state = build_compiled_state(config, merge_index, next_repo_profile, latest)
    output_paths = get_compile_output_paths(repo_root, config)

    write_json(output_paths["repoProfile"], next_repo_profile)
    write_json(output_paths["ruleStore"], rule_store)
    write_text(
        output_paths["compiledSpec"],
        render_compiled_spec_markdown(next_repo_profile, knowledge_dict, spec_dict),
    )
    write_text(
        output_paths["sessionStartInjection"],
        render_session_start_injection(next_repo_profile, latest, knowledge_dict, spec_dict),
    )
    shared_injection = render_shared_injection(
        next_repo_profile,
        latest,
        knowledge_dict,
        spec_dict,
    )
    write_text(output_paths["toolInjection"], shared_injection)
    write_text(output_paths["subagentInjection"], shared_injection)
    write_compiled_state(repo_root, compiled_state)


def ensure_compiled_artifacts(repo_root: Path) -> None:
    config = load_config(repo_root)
    merge_index = load_merge_index(repo_root)
    latest = read_artifact_json(
        repo_root,
        config,
        "latestEvidencePath",
        "evidence/latest.json",
    )
    repo_profile = scan_repo_profile(repo_root, config)
    repo_profile = stabilize_repo_profile(repo_root, config, repo_profile)
    compiled_state = build_compiled_state(config, merge_index, repo_profile, latest)
    if has_fresh_compiled_outputs(
        repo_root,
        config,
        load_compiled_state(repo_root),
        get_string_value(compiled_state, "inputHash"),
    ):
        return
    write_compiled_outputs(
        repo_root,
        config,
        merge_index,
        latest,
        repo_profile=repo_profile,
    )


def write_evidence(
    repo_root: Path,
    config: dict[str, object],
    evidence: dict[str, object],
) -> None:
    latest_path = get_artifact_path(
        repo_root,
        config,
        "latestEvidencePath",
        "evidence/latest.json",
    )
    event_id = str(evidence.get("eventId", "event"))
    session_path = get_session_evidence_path(repo_root, event_id)
    write_json(latest_path, evidence)
    write_json(session_path, evidence)


def write_sync_outbox(
    repo_root: Path,
    config: dict[str, object],
    evidence: dict[str, object],
) -> None:
    sync = config.get("sync", {})
    if not isinstance(sync, dict):
        sync = {}

    enabled_value = sync.get("enabled", False)
    if not isinstance(enabled_value, bool) or not enabled_value:
        return

    repo_key_value = sync.get("repoKey", "")
    repo_key = (
        repo_key_value
        if isinstance(repo_key_value, str) and repo_key_value
        else normalize_text(str(config.get("projectName", "repo"))).replace(" ", "-")
    )
    scope_value = sync.get("scope", "repo")
    scope = scope_value if isinstance(scope_value, str) and scope_value else "repo"

    public_namespaces_raw = sync.get("publicNamespaces", [])
    public_namespaces: list[str] = []
    if isinstance(public_namespaces_raw, list):
        for item in public_namespaces_raw:
            if isinstance(item, str) and item:
                public_namespaces.append(item)

    outbox_dir_value = sync.get("outboxDir", "sync/outbox")
    outbox_dir = (
        outbox_dir_value
        if isinstance(outbox_dir_value, str) and outbox_dir_value
        else "sync/outbox"
    )

    merge_data = evidence.get("merge", {})
    quality = evidence.get("quality", {})
    knowledge = evidence.get("knowledge", [])
    candidate_spec = evidence.get("candidateSpec", [])

    envelope = {
        "protocolVersion": 1,
        "eventType": "session_evidence",
        "eventId": evidence.get("eventId"),
        "createdAt": evidence.get("createdAt"),
        "repo": {
            "key": repo_key,
            "name": config.get("projectName"),
            "scope": scope,
            "publicNamespaces": public_namespaces,
        },
        "session": {
            "id": evidence.get("sessionId"),
            "reason": evidence.get("reason"),
        },
        "evidence": {
            "summary": evidence.get("summary"),
            "files": evidence.get("files"),
            "generator": evidence.get("generator"),
            "quality": quality,
        },
        "artifacts": {
            "knowledge": knowledge if isinstance(knowledge, list) else [],
            "candidateSpec": candidate_spec if isinstance(candidate_spec, list) else [],
        },
        "merge": merge_data if isinstance(merge_data, dict) else {},
    }

    event_id = str(evidence.get("eventId", "event"))
    outbox_path = resolve_teamai_path(
        repo_root,
        f"{outbox_dir}/{event_id}.json",
        label="sync.outboxDir",
    )
    write_json(outbox_path, envelope)


def get_summary_state_path(repo_root: Path) -> Path:
    return repo_root / TEAMAI_DIR / "state" / "summary-state.json"


def load_summary_state(repo_root: Path) -> dict[str, object]:
    data = read_json(get_summary_state_path(repo_root))
    if not data:
        return {"requests": {}}

    requests = data.get("requests")
    if not isinstance(requests, dict):
        requests = {}
    return {"requests": requests}


def prune_summary_state(state: dict[str, object], keep: int = 200) -> dict[str, object]:
    requests = state.get("requests")
    if not isinstance(requests, dict):
        return {"requests": {}}

    if len(requests) <= keep:
        return {"requests": requests}

    ordered = sorted(
        (
            value
            for value in requests.values()
            if isinstance(value, dict)
        ),
        key=lambda record: str(record.get("updatedAt") or record.get("createdAt") or ""),
        reverse=True,
    )
    trimmed = {
        str(record.get("requestId")): record
        for record in ordered[:keep]
        if isinstance(record.get("requestId"), str)
    }
    return {"requests": trimmed}


def save_summary_state(repo_root: Path, state: dict[str, object]) -> None:
    write_json(get_summary_state_path(repo_root), prune_summary_state(state))


def upsert_summary_request(repo_root: Path, request: dict[str, object]) -> None:
    state = load_summary_state(repo_root)
    requests = state.get("requests")
    if not isinstance(requests, dict):
        requests = {}
        state["requests"] = requests
    request_id = get_string_value(request, "requestId")
    if not request_id:
        return
    requests[request_id] = request
    save_summary_state(repo_root, state)


def list_summary_requests(
    state: dict[str, object],
    *,
    session_id: str | None = None,
    statuses: set[str] | None = None,
) -> list[dict[str, object]]:
    requests = state.get("requests")
    if not isinstance(requests, dict):
        return []

    matches: list[dict[str, object]] = []
    for value in requests.values():
        if not isinstance(value, dict):
            continue
        if session_id is not None and get_string_value(value, "sessionId") != session_id:
            continue
        if statuses is not None:
            status = get_string_value(value, "status")
            if status not in statuses:
                continue
        matches.append(value)

    matches.sort(
        key=lambda record: str(record.get("updatedAt") or record.get("createdAt") or ""),
        reverse=True,
    )
    return matches


def find_request_by_agent_id(
    state: dict[str, object],
    agent_id: str,
) -> dict[str, object] | None:
    if not agent_id:
        return None
    for request in list_summary_requests(state):
        if get_string_value(request, "agentId") == agent_id:
            return request
    return None


def find_request_by_message_fingerprint(
    state: dict[str, object],
    session_id: str,
    message_fingerprint: str,
) -> dict[str, object] | None:
    if not session_id or not message_fingerprint:
        return None
    for request in list_summary_requests(state, session_id=session_id):
        if get_string_value(request, "messageFingerprint") == message_fingerprint:
            return request
    return None


def build_summary_request(
    input_data: dict[str, object],
    repo_root: Path,
    stop_config: dict[str, object],
    snapshot: dict[str, object],
) -> dict[str, object]:
    last_message = get_last_assistant_message(input_data).strip()
    message_fingerprint = fingerprint_text(last_message)[:16]
    files = snapshot.get("worktreeFiles", [])
    if not isinstance(files, list):
        files = []
    event = build_event(
        input_data,
        repo_root,
        event_kind="stop_summary",
        message_fingerprint=message_fingerprint,
        snapshot=snapshot,
    )

    return {
        "requestId": str(event.get("eventId")),
        "event": event,
        "sessionId": str(event.get("sessionId")),
        "transcriptPath": str(event.get("transcriptPath")),
        "messageFingerprint": message_fingerprint,
        "assistantMessageExcerpt": last_message[: int(stop_config["maxAssistantExcerptChars"])],
        "assistantMessageChars": len(last_message),
        "filesSnapshot": files[:20],
        "agentName": str(stop_config["agentName"]),
        "agentId": "",
        "status": "pending",
        "blockCount": 0,
        "createdAt": str(event.get("createdAt")),
        "updatedAt": str(event.get("createdAt")),
    }


def should_request_stop_summary(
    stop_config: dict[str, object],
    files: list[str],
    last_message: str,
) -> bool:
    files_trigger = len(files) >= int(stop_config["minimumChangedFiles"])
    chars_trigger = len(last_message.strip()) >= int(stop_config["minimumAssistantChars"])

    if files_trigger:
        return True
    if bool(stop_config["allowWithoutChanges"]) and chars_trigger:
        return True
    return False


def build_stop_reason(
    request: dict[str, object],
    stop_config: dict[str, object],
) -> str:
    agent_name = get_string_value(request, "agentName") or str(stop_config["agentName"])
    request_id = get_string_value(request, "requestId")
    files = request.get("filesSnapshot", [])
    file_lines: list[str] = []
    if isinstance(files, list):
        for item in files[: int(stop_config["maxFilesInReason"])]:
            if isinstance(item, str) and item:
                file_lines.append(f"- {item}")

    lines = [
        (
            f"Before stopping, launch the `{agent_name}` subagent exactly once for "
            f"TeamAI summary request `{request_id}`."
        ),
        "Ask it to return strict JSON with keys `summary`, `knowledge`, and `candidate_spec`.",
        "The hook system will attach the request context automatically.",
        "Do not rewrite that JSON yourself. Let the subagent finish, then stop.",
    ]
    if file_lines:
        lines.extend(["Relevant changed files:", *file_lines])

    reason = "\n".join(lines).strip()
    max_chars = int(stop_config["maxReasonChars"])
    if len(reason) <= max_chars:
        return reason
    return reason[:max_chars].rstrip()


def persist_summary(
    repo_root: Path,
    event: dict[str, object],
    payload: dict[str, object],
    generator: str,
    source_meta: dict[str, object] | None = None,
) -> dict[str, object]:
    event_id = get_string_value(event, "eventId")
    existing = read_json(get_session_evidence_path(repo_root, event_id))
    if existing:
        return existing

    config = load_config(repo_root)
    capture_config = get_capture_config(config)
    promotion_rules = get_promotion_rules(config)
    excluded_prefixes = capture_config["excludePathPrefixes"]
    if not isinstance(excluded_prefixes, list):
        excluded_prefixes = list(DEFAULT_CAPTURE_CONFIG["excludePathPrefixes"])

    max_transcript_chars = int(capture_config["maxTranscriptChars"])
    max_diff_chars = int(capture_config["maxDiffChars"])

    used_worktree_snapshot = False
    files_value = event.get("worktreeFiles")
    files = (
        [item for item in files_value if isinstance(item, str) and item]
        if isinstance(files_value, list)
        else get_worktree_files(repo_root, excluded_prefixes)
    )
    if isinstance(files_value, list):
        used_worktree_snapshot = True
    diff_value = event.get("worktreeDiff")
    diff_text = (
        diff_value
        if isinstance(diff_value, str)
        else get_worktree_diff(repo_root, max_diff_chars, excluded_prefixes)
    )
    if isinstance(diff_value, str):
        used_worktree_snapshot = True
    transcript_path = get_string_value(event, "transcriptPath")
    transcript_text = read_transcript_excerpt(transcript_path, max_transcript_chars)

    summary_value = payload.get("summary", "")
    summary = summary_value.strip() if isinstance(summary_value, str) else ""
    if not summary:
        summary = "Session captured."

    knowledge = clean_bullets(payload.get("knowledge"))
    candidate_raw = payload.get("candidate_spec", payload.get("candidateSpec", []))
    candidate_spec = clean_bullets(candidate_raw)

    quality = score_quality(
        transcript_text,
        diff_text,
        files,
        generator,
        summary,
        knowledge,
        candidate_spec,
    )
    eligible, minimum_grade = merge_allowed(quality, config)

    merge_index = load_merge_index(repo_root)
    knowledge_records = merge_index.get("knowledge")
    candidate_records = merge_index.get("candidateSpec")
    knowledge_dict = knowledge_records if isinstance(knowledge_records, dict) else {}
    candidate_dict = candidate_records if isinstance(candidate_records, dict) else {}

    knowledge_stats = {"added": 0, "updated": 0, "skipped": len(knowledge)}
    candidate_stats = {"added": 0, "updated": 0, "skipped": len(candidate_spec)}
    if eligible:
        created_at = get_string_value(event, "createdAt") or now_iso()
        merge_index["knowledge"], knowledge_stats = merge_collection(
            knowledge_dict,
            knowledge,
            created_at,
            event_id,
            quality,
            promotion_rules,
        )
        merge_index["candidateSpec"], candidate_stats = merge_collection(
            candidate_dict,
            candidate_spec,
            created_at,
            event_id,
            quality,
            promotion_rules,
        )
        write_merge_outputs(repo_root, config, merge_index, promotion_rules)

    source = {
        "transcriptAvailable": bool(transcript_text.strip()),
        "transcriptChars": len(transcript_text.strip()),
        "diffChars": len(diff_text.strip()),
    }
    if used_worktree_snapshot:
        source["worktreeSnapshotUsed"] = True
    captured_at = get_string_value(event, "worktreeCapturedAt")
    if captured_at:
        source["worktreeSnapshotCapturedAt"] = captured_at
    if isinstance(source_meta, dict):
        source.update(source_meta)

    evidence = {
        "eventId": event_id,
        "eventKind": event.get("eventKind"),
        "createdAt": event.get("createdAt"),
        "sessionId": event.get("sessionId"),
        "reason": event.get("reason"),
        "summary": summary,
        "files": files,
        "generator": generator,
        "quality": quality,
        "knowledge": knowledge,
        "candidateSpec": candidate_spec,
        "merge": {
            "minimumGrade": minimum_grade,
            "eligible": eligible,
            "promotion": promotion_rules,
            "knowledge": knowledge_stats,
            "candidateSpec": candidate_stats,
        },
        "source": source,
    }

    write_evidence(repo_root, config, evidence)
    write_sync_outbox(repo_root, config, evidence)
    write_compiled_outputs(repo_root, config, merge_index, evidence)
    return evidence
