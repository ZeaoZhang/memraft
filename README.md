# Memraft

Standalone local-first, hook-first memory and guidance extraction for Claude Code, Gemini CLI, Codex, and OpenCode.

The current MVP keeps Claude's hook-based automatic path, adds Gemini CLI's
official hook path, uses Codex's repo-local hook path, and uses an
OpenCode project plugin so all four
tools can feed the same `.memraft/` memory.

The current direction is no longer "auto-write draft Markdown and inject that
directly". Memraft now aims to:

1. extract repeatable knowledge from normal CLI work
2. store rules in structured local state
3. compile repo facts plus promoted rules into injectable spec artifacts
4. inject those compiled artifacts back into future sessions

This project is intentionally standalone. It contains only the minimum pieces
needed to:

1. initialize a `.memraft/` runtime directory in a target repository
2. install a project summary subagent under `.claude/agents/`
3. inject promoted local knowledge into Claude and Gemini sessions
4. capture reusable knowledge through a Claude `Stop -> subagent -> persist` flow
5. defer session-end summarization in the background if the stop summary never completes
6. promote repeated knowledge into reusable local memory
7. compile promoted rules into reusable injectable spec files
8. let Codex and OpenCode write back into the same local memory store automatically through repo-local adapter hooks

## Commands

```bash
memraft init [target-dir] [--force] [--skip-existing]
memraft status [target-dir] [--json]
memraft recall <query> [target-dir] [--scope <scope>] [--task <task-id>] [--limit <n>] [--json]
memraft task create <title> [target-dir] [--slug <slug>] [--json]
memraft task start <task-id> [target-dir] [--json]
memraft task finish <task-id> [target-dir] [--json]
memraft task show <task-id> [target-dir] [--json]
memraft promote <memory-id> [target-dir] [--json]
memraft accept <fingerprint> [target-dir] --into <background|conventions|workflows> [--json]
memraft inspect latest [target-dir] [--json]
memraft inspect pending [target-dir] [--json]
memraft inspect proposals [target-dir] [--json]
memraft inspect rules [target-dir] [--json]
memraft inspect compiled [target-dir] [--json]
memraft inspect lineage <fingerprint> [target-dir] [--json]
```

## Usage

From this project directory:

```bash
node ./bin/memraft.js init /path/to/your/repo
```

Or make the CLI available on your machine:

```bash
npm link
memraft init /path/to/your/repo
```

Useful flags:

```bash
memraft init /path/to/your/repo --force
memraft init /path/to/your/repo --skip-existing
```

If you re-run `init` after `.memraft/` already exists, you now must choose an
explicit strategy:

- `--skip-existing` preserves existing Memraft files
- `--force` overwrites generated Memraft files

Re-running `init` still refreshes the managed Memraft hook entries inside
`.claude/settings.json` so command/timeout upgrades can roll forward without
duplicating hooks.

Inspect status after initialization:

```bash
memraft status /path/to/your/repo
memraft task create "auth cleanup" /path/to/your/repo --slug auth-cleanup
memraft task start auth-cleanup /path/to/your/repo
memraft recall "runtime surface" /path/to/your/repo
memraft inspect pending /path/to/your/repo
memraft inspect proposals /path/to/your/repo
memraft accept <fingerprint> /path/to/your/repo --into conventions
memraft inspect latest /path/to/your/repo
memraft inspect rules /path/to/your/repo
memraft inspect compiled /path/to/your/repo
```

## What Gets Created

The command writes a `.memraft/` directory into the target repository, merges
Claude hooks into `.claude/settings.json`, merges Gemini hooks into
`.gemini/settings.json`, writes a repo-local Codex hook config into
`.codex/config.toml` plus `.codex/hooks.json`, and writes an OpenCode auto-capture plugin under
`.opencode/plugins/`.

It also installs a project subagent at
`.claude/agents/memraft-memory-summarizer.md`.

The runtime now boots a local SQLite index at `.memraft/state/index.sqlite`.
Legacy JSON and Markdown files remain available as compiled compatibility views.

Memraft also creates a checked-in shared guidance layer under `memraft/`:

- `memraft/spec/background.md`
- `memraft/spec/conventions.md`
- `memraft/spec/workflows.md`
- `memraft/registry.json`

The runtime details and learning model are documented in the generated
`.memraft/README.md`.

The generated hooks resolve `.memraft/hooks/*.mjs` from `CLAUDE_PROJECT_DIR`,
`GEMINI_PROJECT_DIR`, or by searching upward from the current working
directory, so they keep working from nested subdirectories without baking in
machine-specific absolute paths.

## Typical Flow

1. run `memraft init /path/to/repo`
2. keep using Claude Code normally in that repo
3. by default, Claude only runs the stop summary flow after a long enough conversation
4. run `memraft status /path/to/repo`
5. inspect the most recent extraction with `memraft inspect latest /path/to/repo`

After enough repeated evidence, items move from candidate state into promoted
memory and start getting injected into future Claude sessions.

Promoted local rules can then be reviewed with `memraft inspect proposals` and
accepted into the checked-in `memraft/spec/` layer with `memraft accept`.

Memraft now compiles four layers automatically:

- repo profile from stable repository facts
- checked-in shared spec from `memraft/spec/`
- active task context from local task memory
- promoted learned rules from repeated evidence
- injectable session/tool context derived from both

Promoted rules now carry typed metadata such as `kind`, `scope`, `paths`,
`sourceEvidenceIds`, and lifecycle state, so the runtime can invalidate stale rules
when the repository drifts.

Claude now defaults to the higher-quality blocking flow, but it does not fire
for every stop. Memraft first checks whether the conversation is long enough
before it asks Claude to launch `memraft-memory-summarizer`. This prevents
trivial checks such as `hi` / model-availability probes from triggering a stop
summary just because the repository happens to have changed files.

When the conversation passes that threshold, the `Stop` hook blocks once, asks
Claude to launch `memraft-memory-summarizer`, and persists its strict JSON at
`SubagentStop`. If that full-mode path never completes, `SessionEnd` keeps the
captured request context and finishes a deferred background summary instead of
dropping straight to empty fallback evidence.

Gemini CLI now gets automatic `SessionStart`, `BeforeAgent`, and `SessionEnd`
hooks, so compiled Memraft context is injected without manual copy/paste and
session-end fallback capture can run automatically there as well.

Codex now gets a repo-local automatic path through `.codex/config.toml`
with `features.codex_hooks = true` plus `.codex/hooks.json` for
`SessionStart`, `UserPromptSubmit`, and `Stop`. OpenCode still gets an
automatic capture path through `.opencode/plugins/memraft-auto-capture.js`.
Those non-Claude paths do not have Claude's stop-time subagent summary quality,
but they can persist fallback evidence and extracted rule candidates without
requiring a manual command.

`stopSummary` is user-configurable in `.memraft/config.json`:

```json
{
  "stopSummary": {
    "enabled": true,
    "mode": "full",
    "minimumConversationChars": 1200
  }
}
```

- `mode: "full"` is the default. It uses the explicit stop-time subagent
  summary flow, but only after a long enough conversation.
- `minimumConversationChars` controls what counts as a long conversation.
- `mode: "light"` keeps stop invisible and performs a cheap background summary
  at session end instead.
- `enabled: false` disables Claude's stop/session-end summary path entirely.

Evidence excludes tool-managed paths such as `.memraft/`, `.omc/`, `.claude/`,
`.codex/`, `.opencode/`, and `.git/`, and sync outbox envelopes are only
written when `sync.enabled` is true.

The runtime snapshots changed files and diff state when it creates a stop/session-end
event, so async persistence still reflects the original session state.

Generated artifacts are also compile-cached, so repeated hot-path hooks do not
rewrite spec and injection files when their inputs are unchanged.

Memraft also compiles adapter-ready instruction files for Codex, Gemini CLI, and
OpenCode under `.memraft/generated/adapters/`.

The v2 runtime also stores searchable evidence chunks and pending promotion
candidates in SQLite, so the runtime can support local recall, task-scoped memory,
and explicit promotion without introducing any external service.

Manual capture still remains available as a fallback:

```bash
node .memraft/hooks/manual_capture.mjs --tool <codex|gemini-cli|opencode|claude-code>
```

The capture payload stays strict JSON with `summary`, `knowledge`, and
`candidate_spec`, so the same promotion and compilation pipeline can merge local
experience from Claude Code, Gemini CLI, Codex, and OpenCode into one private
`.memraft/` runtime.

Configured artifact and outbox paths are now constrained to `.memraft/`, so
custom nesting is allowed but path traversal outside the runtime directory is
rejected.

## Scope

This repository currently provides:

- a standalone initializer
- generated `.memraft` runtime templates
- generated `.claude/agents/memraft-memory-summarizer.md`
- Claude hook integration
- Gemini CLI hook integration
- Codex repo-local hooks integration
- OpenCode project plugin integration
- stop-time summary capture with session-end fallback
- local promotion logic
- checked-in shared spec source under `memraft/spec/`
- CLI proposal review and accept flow for shared spec
- typed rule metadata with repo reconciliation
- local inspection commands
- local recall, task, pending-promotion, and promote commands
- structured rule store and compiled spec artifacts
- SQLite-backed runtime state with legacy compatibility views
- automatic or manual local capture paths for Codex and OpenCode

It does not yet provide:

- shared server sync
- multi-user merge conflict handling
- review queue UI
- semantic clustering or advanced dedup
