# TeamAI Local MVP

Standalone local-first, hook-first memory extraction for Claude Code.

The current direction is no longer "auto-write draft Markdown and inject that
directly". TeamAI now aims to:

1. extract repeatable knowledge from normal CLI work
2. store rules in structured local state
3. compile repo facts plus promoted rules into injectable spec artifacts
4. inject those compiled artifacts back into future sessions

This project is intentionally standalone. It contains only the minimum pieces
needed to:

1. initialize a `.teamai/` runtime directory in a target repository
2. install a project summary subagent under `.claude/agents/`
3. inject promoted local knowledge into Claude sessions
4. capture reusable knowledge through a `Stop -> subagent -> persist` flow
5. fall back at `SessionEnd` only if no completed stop summary exists
6. promote repeated knowledge into reusable local memory
7. compile promoted rules into reusable injectable spec files

## Commands

```bash
teamai-local init [target-dir] [--force] [--skip-existing]
teamai-local status [target-dir] [--json]
teamai-local inspect latest [target-dir] [--json]
```

## Usage

From this project directory:

```bash
node ./bin/teamai-local.js init /path/to/your/repo
```

Or make the CLI available on your machine:

```bash
npm link
teamai-local init /path/to/your/repo
```

Useful flags:

```bash
teamai-local init /path/to/your/repo --force
teamai-local init /path/to/your/repo --skip-existing
```

If you re-run `init` after `.teamai/` already exists, you now must choose an
explicit strategy:

- `--skip-existing` preserves existing TeamAI files
- `--force` overwrites generated TeamAI files

Re-running `init` still refreshes the managed TeamAI hook entries inside
`.claude/settings.json` so command/timeout upgrades can roll forward without
duplicating hooks.

Inspect status after initialization:

```bash
teamai-local status /path/to/your/repo
teamai-local inspect latest /path/to/your/repo
```

## What Gets Created

The command writes a `.teamai/` directory into the target repository and merges
Claude hooks into `.claude/settings.json`.

It also installs a project subagent at
`.claude/agents/teamai-memory-summarizer.md`.

The runtime details and learning model are documented in the generated
`.teamai/README.md`.

The generated hooks resolve `.teamai/hooks/*.py` from `CLAUDE_PROJECT_DIR`, so
they keep working from nested subdirectories without baking in machine-specific
absolute paths.

## Typical Flow

1. run `teamai-local init /path/to/repo`
2. keep using Claude Code normally in that repo
3. when Claude tries to stop, let it run the TeamAI summary subagent once
4. run `teamai-local status /path/to/repo`
5. inspect the most recent extraction with `teamai-local inspect latest /path/to/repo`

After enough repeated evidence, items move from candidate state into promoted
memory and start getting injected into future Claude sessions.

TeamAI now compiles three layers automatically:

- repo profile from stable repository facts
- promoted learned rules from repeated evidence
- injectable session/tool context derived from both

The primary path now happens before shutdown: a `Stop` hook blocks once, asks
Claude to launch `teamai-memory-summarizer`, and persists its strict JSON at
`SubagentStop`. `SessionEnd` is fallback-only and exists to avoid losing the
session if that stop-time path never completes.

Evidence excludes tool-managed paths such as `.teamai/`, `.omc/`, `.claude/`,
and `.git/`, and sync outbox envelopes are only written when `sync.enabled` is
true.

TeamAI snapshots changed files and diff state when it creates a stop/session-end
event, so async persistence still reflects the original session state.

Configured artifact and outbox paths are now constrained to `.teamai/`, so
custom nesting is allowed but path traversal outside the runtime directory is
rejected.

## Scope

This repository currently provides:

- a standalone initializer
- generated `.teamai` runtime templates
- generated `.claude/agents/teamai-memory-summarizer.md`
- Claude hook integration
- stop-time summary capture with session-end fallback
- local promotion logic
- local inspection commands
- structured rule store and compiled spec artifacts

It does not yet provide:

- shared server sync
- multi-user merge conflict handling
- review queues
- semantic clustering or advanced dedup
