<!-- MEMRAFT:BEGIN project-context -->
# Memraft Context

This file is compiled for `AGENTS.md` consumers from repo facts plus promoted Memraft rules.
If repository code conflicts with a note below, trust the repository state.

## Repository Background

- Project: memraft
- Workspace: single-package
- Languages: javascript
- test: node --test

## Stable Project Rules

- No promoted rules yet.

## Stable Learned Knowledge

- No promoted knowledge yet.

## Recent Evidence Snapshot

Implemented a product-facing shared spec layer for Memraft with checked-in memraft/spec templates, proposal review via inspect proposals, acceptance via accept --into, and compilation of accepted shared guidance back into generated artifacts and status surfaces.
Quality grade: A
Files touched:
- .gitignore
- README.md
- bin/teamai-local.js
- docs/next-stage-plan.md
- package.json
- src/cli.js

## Adapter Runtime

- Codex adapter mode: full
- Automatic Codex capture is enabled.

## Session Capture Protocol

When you finish substantive work or discover a durable project rule, write a strict JSON capture back into the local Memraft runtime.

```bash
node .memraft/hooks/manual_capture.mjs --tool <codex|gemini-cli|opencode|claude-code> <<'EOF'
{"summary":"1-3 sentence summary","knowledge":["stable repo fact"],"candidate_spec":["reusable convention or contract"]}
EOF
```

- Replace `<...>` with the current CLI.
- Keep `knowledge` for stable repo facts, architecture notes, and project background.
- Keep `candidate_spec` for reusable workflows, conventions, contracts, or path-scoped rules.
- Skip one-off trivia.
- Run this before ending the session when the work produced reusable knowledge.
<!-- MEMRAFT:END project-context -->
