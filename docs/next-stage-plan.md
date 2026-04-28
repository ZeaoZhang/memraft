# Next Stage Plan

## Stage Goal

Move Memraft from a Claude-only local MVP into an autonomous spec pipeline that:

1. captures reusable project rules without human review
2. compiles stable and hot context separately
3. injects the compiled output into multiple CLI tools
4. keeps learned rules aligned with the live repository

## Exit Criteria

- stop/session-end flows still produce structured learning even when the summary subagent does not finish in time
- hot hooks stop doing full recompilation on every call
- the rule store supports typed records instead of only free-form text buckets
- stale rules can be invalidated or demoted automatically
- writes are atomic and safe under concurrent hook execution
- adapter surfaces exist for Claude, Codex, Gemini CLI, and OpenCode

## Workstreams

### 1. Reliable Autonomous Capture

- add a deferred summarization path so `SessionEnd` preserves learning, not only fallback evidence
- preserve enough source data for background extraction from transcript and captured worktree state
- treat untracked-file creation as first-class evidence in quality scoring

### 2. Fast Compile and Injection

- add a compile cache keyed by config, repo profile inputs, merge index, and latest evidence fingerprints
- split artifacts into:
  - stable spec for repo-native instruction files
  - hot recent memory for runtime hook injection
- keep `SessionStart`, `PreToolUse`, and `SubagentStart` on read-mostly code paths

### 3. Typed Rule Engine

- replace text-only records with typed rules carrying:
  - `kind`
  - `scope`
  - `paths`
  - `tool`
  - `sourceEvidenceIds`
  - `confidence`
  - `supersedes`
  - `invalidatedAt`
- compile different slices from the same rule base:
  - repo background
  - stable conventions
  - path-scoped hints
  - tool-specific injections

### 4. Reconciliation and Drift Control

- compare promoted rules against the current repo profile and invalidate contradictions
- add freshness metadata and demotion rules for old or unsupported records
- keep lineage so a compiled spec line can be traced back to its evidence and rule record

### 5. Runtime Safety and Observability

- use atomic temp-file writes plus rename for all generated state
- add a lock around merge/compile transactions
- extend CLI inspection with:
  - `inspect rules`
  - `inspect repo-profile`
  - `inspect compiled`
  - `inspect lineage <fingerprint>`

### 6. Multi-Tool Adapter Layer

- extract tool adapters behind a shared compiler output contract
- support native instruction surfaces per tool:
  - Claude: hooks plus `CLAUDE.md`
  - Codex: `AGENTS.md`
  - Gemini CLI: `GEMINI.md`
  - OpenCode: `AGENTS.md` plus project plugins where needed
- keep tool-specific glue thin and push intelligence into the shared rule compiler

## Recommended Sequence

1. Reliable autonomous capture
2. Atomic writes and compile cache
3. Typed rule engine
4. Reconciliation and lineage
5. CLI observability
6. Multi-tool adapters

## First Milestone

The first implementation milestone should deliver four concrete changes:

1. deferred session-end summarization with preserved source context
2. untracked-file-aware scoring
3. hash-based compile skipping
4. atomic writes for merge and generated artifacts

This milestone should improve unattended reliability before any schema expansion or multi-tool work begins.
