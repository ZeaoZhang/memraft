# Candidate Spec Draft

This file stores deduplicated candidate conventions, contracts, and workflows.

## Promotion Rules

- Promote after x2 repeated occurrences, 2 evidence events, confidence >= 0.68.
- Only promoted entries are injected back into Claude context.

## Promoted Entries

- No promoted entries yet.

## Candidate Queue

- [A|100|x1|c0.74|workflow|repo] When extending Memraft product surfaces, keep the private .memraft runtime separate from the checked-in memraft/spec layer, and verify that status, compiled outputs, and adapter docs all reflect the same current truth.
- [A|100|x1|c0.74|rule|repo] When productizing Memraft, prioritize shared-spec separation, proposal acceptance flow, and truth-surface alignment before adding advanced clustering, sync, or UI polish.
- [A|100|x1|c0.74|path-rule|path] When changing generated Memraft hook/runtime behavior, keep the repo-local adapters and test fixtures aligned by updating `src/init.js`, `.memraft` templates, generated adapter docs/config, and `test/memraft.test.js` together.
- [A|100|x1|c0.74|workflow|repo] Memory relation edges for contradicts, extends, updates, and supersedes should use canonical storage ordering while semantic direction lives in edge details.
- [A|100|x1|c0.74|workflow|repo] When rendering TeamAI adapter outputs, derive adapter modes before compile and include those modes in injected/native text so inject-only conflicts are visible to agents.
- [A|100|x1|c0.74|workflow|repo] Task-scoped captures should not auto-promote into repo memory; use explicit promotion or repo-scope capture paths for stable rules.
- [A|100|x1|c0.74|rule|repo] When extending TeamAI runtime behavior, persist new state in SQLite first and treat JSON/Markdown files as compiled compatibility views.
- [A|95|x1|c0.70|workflow|repo] When changing Codex adapter behavior, update the runtime generator, native adapter state reporting, generated adapter docs/artifacts, and integration tests together so the user-facing status surface stays aligned with actual Codex behavior.
- [A|95|x1|c0.70|workflow|repo] Keep TeamAI captures strict JSON-only.

## Invalidated Entries

- [A|100|x1|c0.74|rule|repo] When evaluating Memraft usability, verify three layers: npm test, npm pack --dry-run contents, and a fresh temp-repo smoke flow covering init, status, compiled artifacts, and at least one capture-plus-recall path.
- [B|70|x1|c0.54|path-rule|path] src/app.js should stay on the project runtime surface.
