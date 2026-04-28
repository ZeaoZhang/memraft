# Shared Knowledge Memory

This file is auto-generated from deduplicated session evidence.

## Promotion Rules

- Promote after x2 repeated occurrences, 2 evidence events, confidence >= 0.68.
- Only promoted entries are injected back into Claude context.

## Promoted Entries

- No promoted entries yet.

## Candidate Queue

- [A|100|x1|c0.74|path-fact|path] Memraft now has a concrete bridge from promoted local memory into checked-in shared guidance through memraft/spec and memraft/registry.json.
- [A|100|x1|c0.74|repo-fact|repo] Shared-spec productization also needed reliability work: SQLite access now uses a busy timeout and avoids forcing WAL mode on every connection when already enabled.
- [A|100|x1|c0.74|knowledge|repo] Memraft already has a strong local runtime, typed rule pipeline, and multi-tool adapters, but product value stays hidden when pending candidates do not become visible promoted/shared guidance.
- [A|100|x1|c0.74|repo-fact|repo] Memraft is practically usable today for repo-local memory injection and capture across Codex, Claude, Gemini, and OpenCode, with the strongest direct quality signal coming from passing tests plus temp-repo smoke runs.
- [A|100|x1|c0.74|path-fact|path] The current package metadata understates the runtime requirement because src/runtime.js imports node:sqlite while package.json still declares node >=18.17.0.

## Invalidated Entries

- [A|100|x1|c0.74|repo-fact|repo] Vibe-Skills models memory as explicit planes with canonical owners and shadow-first governance, which is a strong reference for Memraft product design.
- [A|100|x1|c0.74|path-fact|path] Memraft now uses Node-only generated hooks under `.memraft/hooks/*.mjs`, with `runtime.mjs` owning capture, compile, summary-state, and SQLite runtime behavior.
- [A|100|x1|c0.74|repo-fact|repo] The project's verification contract for this migration is covered by `npm test`, which now exercises the Node hook entrypoints instead of Python scripts.
- [A|100|x1|c0.74|path-fact|path] teamai-local status now reads runtime/latest directly from .teamai/state/index.sqlite instead of runtime-summary.json or evidence/latest.json.
- [A|100|x1|c0.74|path-fact|path] templates/.teamai/hooks/pipeline.py now treats SQLite as the runtime fact store and compiles JSON/Markdown compatibility views from it.
- [A|100|x1|c0.74|path-fact|path] templates/.teamai/hooks/storage.py owns the SQLite runtime for events, memories, tasks, audit rows, and recall indexes.
- [A|100|x1|c0.74|path-fact|path] templates/.teamai/hooks/teamai_cli.py is the repo-local Python CLI for recall, task, promote, and pending inspection commands.
- [A|95|x1|c0.70|path-fact|path] Memraft's source-level Codex integration now targets repo-local hooks via `.codex/hooks.json` and keeps `.codex/config.toml` focused on enabling `features.codex_hooks`.
- [A|95|x1|c0.70|path-fact|path] app.js is part of the local runtime surface.
