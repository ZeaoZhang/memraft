# Multi-Tool Memory And Spec Architecture

## Goal

Evolve Memraft from a strong local MVP into a system that can:

1. observe normal work across Claude Code, Codex, Gemini CLI, and OpenCode
2. learn reusable project knowledge from that work
3. compile the learned knowledge into stable project guidance
4. inject the right context back into future sessions with minimal manual steps

The key product requirement is not only "remember things", but "turn repeated
experience into a reusable project spec layer".

## Current State

Memraft already has a solid core:

- Claude Code has an automatic hook path for session start, stop, subagent
  summary, and session-end fallback.
- All tools can write into the same `.memraft/` pipeline via
  `hooks/manual_capture.mjs`.
- Learned records are promoted into a typed rule store with lifecycle metadata.
- Promoted rules are compiled into:
  - `generated/spec.md`
  - hot injection artifacts
  - generated adapter files for Codex, Gemini CLI, and OpenCode
- Native project entrypoints are refreshed automatically:
  - `AGENTS.md`
  - `GEMINI.md`
  - `opencode.json`

This means Memraft already supports:

- local memory extraction
- typed rule promotion
- compiled spec generation
- multi-tool instruction output

The current limitation is not the compiler. The limitation is the capture and
ownership model around non-Claude tools.

## Main Gaps

### 1. Non-Claude capture quality is still uneven

Claude has the strongest native path. Codex now has repo-local hooks, Gemini
CLI has its hook surface, and OpenCode has a plugin path, but the quality and
shape of automatic capture still differs across tools.

That is workable for an MVP, but it is not yet a uniform product loop. The more
tool-specific fallback logic we keep, the harder it is to guarantee equivalent
learning quality across CLIs.

### 2. Local runtime and shared project rules are mixed conceptually

`.memraft/` is a local runtime and is added to `.gitignore` by default. That is
correct for evidence snapshots, merge state, logs, and personal learning.

However, a durable project spec should not live only inside an ignored runtime.
Some knowledge is:

- local and private
- project-wide and shareable
- generated from repeated evidence but worth human review

The product needs a two-layer model instead of one bucket.

### 3. There is no explicit source-of-truth spec layer

Today Memraft compiles generated artifacts well, but it does not yet distinguish
between:

- generated rule output
- human-maintained project conventions
- reviewed promotions accepted as permanent standards

Trellis is useful reference here: it separates workspace memory from checked-in
specs. Memraft should keep its automatic learning advantage, but borrow that
structural separation.

### 4. Injection is not yet strongly task-scoped

The compiler already separates stable spec and hot injection, but the output is
still mostly broad project context. Over time, the system should decide:

- which rules apply to the current tool
- which rules apply to the current path or file set
- which rules are stable enough for repo-native instruction files
- which rules are only recent working memory

### 5. Adapter strategy is not symmetrical across tools

Claude supports hooks, so it gets automatic capture and hot injection.

Codex, Gemini CLI, and OpenCode now have automatic entrypoints, but they still
have weaker capture quality than Claude's stop-time subagent path. Product
quality will stay uneven until the non-Claude tools have a similarly rich
collection path.

## Recommended Product Model

Use three distinct layers.

### Layer 1: Local Runtime Memory

Keep `.memraft/` as a local, ignored runtime.

This layer should contain:

- evidence snapshots
- session events
- merge state
- rule store
- compile cache
- local recent memory
- personal tool usage patterns

This layer is private by default.

### Layer 2: Shared Spec Source

Add a checked-in source directory for stable, reviewable project guidance.

Recommended shape:

```text
memraft/
├── spec/
│   ├── background.md
│   ├── conventions.md
│   ├── workflows.md
│   └── paths/
│       ├── src.md
│       └── test.md
└── registry.json
```

This layer should contain:

- human-authored project standards
- reviewed promotions accepted from Memraft learning
- path-scoped rules worth sharing with the team
- contracts, workflows, and anti-patterns

This is the durable source of truth for repo-wide norms.

### Layer 3: Generated Adapters

Continue compiling generated outputs for tool-native entrypoints.

This layer should remain generated:

- `AGENTS.md`
- `GEMINI.md`
- `opencode.json`
- `.memraft/generated/spec.md`
- `.memraft/generated/inject/*.txt`

It should be built from:

- checked-in shared spec source
- promoted local runtime rules
- repo profile facts
- recent session context

## Recommended Capture Model

### Claude Code

Keep the current hook-driven path.

It already has the strongest implementation and should remain the reference
pipeline for autonomous capture quality.

### Codex, Gemini CLI, OpenCode

Move from "manual capture protocol only" to "automatic capture with manual
fallback".

The recommended order is:

1. keep the current manual capture protocol for compatibility
2. add generated wrapper commands per tool
3. let the wrapper:
   - launch the real CLI
   - capture exit status, cwd, and optional transcript path
   - invoke Memraft summarization or capture on successful substantive sessions
4. fall back to explicit manual capture when wrapper-based automation is not
   available

This avoids blocking adoption on undocumented tool internals while still making
the common path automatic.

Wrapper-based automation is the right next step because it is:

- tool-agnostic
- easy to test
- compatible with local-first operation
- safer than depending on unstable internal plugin surfaces

## Recommended Rule Lifecycle

Each learned item should move through four states:

1. `candidate-local`
2. `promoted-local`
3. `proposed-shared`
4. `accepted-shared`

Meaning:

- `candidate-local`: seen but not trusted yet
- `promoted-local`: repeated enough to inject into this developer's future sessions
- `proposed-shared`: good candidate for checked-in team guidance
- `accepted-shared`: reviewed and now part of checked-in spec source

This keeps personal working memory and team standards separate.

## Recommended Compilation Strategy

Compile four distinct outputs from the same knowledge graph.

### 1. Stable Repo Instructions

Used for:

- `AGENTS.md`
- `GEMINI.md`
- static OpenCode instructions

Input:

- shared checked-in spec source
- high-confidence accepted shared rules
- stable repo profile facts

### 2. Hot Session Injection

Used for:

- Claude session start
- Claude subagent/tool injection
- wrapper-driven temporary injection for other CLIs

Input:

- recent evidence
- promoted local rules
- path-scoped current-task hints

### 3. Review Queue Material

Used for:

- proposing local promotions for checked-in shared spec
- presenting evidence-backed rule candidates for human acceptance

Input:

- promoted local rules with strong evidence
- lineage and drift metadata

### 4. Observability Output

Used for:

- `inspect` commands
- debugging rule decisions
- tracing why a rule was injected or invalidated

## Suggested Directory Model

```text
repo/
├── .memraft/                  # local runtime, ignored
│   ├── evidence/
│   ├── generated/
│   ├── hooks/
│   ├── state/
│   └── wrappers/
├── memraft/                   # checked-in project guidance
│   ├── spec/
│   └── registry.json
├── AGENTS.md                 # generated or managed block
├── GEMINI.md                 # generated or managed block
└── opencode.json             # generated or managed block
```

## Implementation Phases

### Phase 1: Make non-Claude capture automatic

Deliver:

- generated wrapper scripts for Codex, Gemini CLI, and OpenCode
- a reusable post-session capture command
- tool-specific metadata in evidence events
- tests proving wrapper-driven capture updates the shared rule store

Success condition:

Users no longer need to remember the manual capture command for the normal path.

### Phase 2: Separate local memory from shared checked-in spec

Deliver:

- a checked-in `memraft/spec/` source tree
- compiler support that merges shared spec source with local promoted rules
- a new rule state for `proposed-shared` and `accepted-shared`

Success condition:

Memraft can keep private learning private while still producing reviewable,
committable project standards.

### Phase 3: Add a promotion-to-spec workflow

Deliver:

- CLI commands such as:
  - `memraft inspect proposals`
  - `memraft promote <fingerprint> --to-shared`
  - `memraft accept <fingerprint> --into conventions`
- file updates into `memraft/spec/` from accepted rules

Success condition:

Repeated local experience can become durable project guidance without manual
copy-paste.

### Phase 4: Improve targeting and injection quality

Deliver:

- path-aware rule slices
- task-aware injection filters
- per-tool renderers tuned for each client surface

Success condition:

Injected context gets shorter and more relevant as the rule base grows.

## Immediate Next Build

If the goal is to ship the next meaningful milestone, build this first:

1. generate tool wrappers for Codex, Gemini CLI, and OpenCode
2. add a small session capture contract for wrapper mode
3. record tool name, cwd, exit code, and optional transcript path
4. keep manual capture as fallback
5. add tests for all three wrapper flows

Do not start with semantic clustering, multi-user sync, or advanced review UI.
Those are downstream features. The next blocker is capture reliability.

## Why This Direction Fits The References

Borrow from Trellis:

- checked-in spec source for team-wide durable norms
- separation between workflow memory and project standards

Borrow from Supermemory:

- memory should be extracted from normal work, not hand-maintained every time
- context should be injected back into the next session automatically

Keep Memraft's own advantage:

- local-first pipeline
- strict evidence and lineage
- promotion into typed rules
- compiler-driven adapter generation

## Bottom Line

Memraft should become:

- a private local runtime for learned evidence
- a compiler for tool-native project instructions
- a bridge that turns repeated local experience into reviewed shared specs

The current codebase already has the compiler core. The next product step is to
make non-Claude capture automatic and to introduce a checked-in shared spec
layer that is separate from `.memraft/`.
