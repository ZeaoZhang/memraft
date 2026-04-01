# Evidence Store

This directory stores extracted evidence from local Claude Code sessions.

- `latest.json` is the most recent extraction
- `sessions/*.json` stores per-session snapshots

Evidence uses only:

- session summary
- changed file list
- quality grade and scoring signals
- extracted memory bullets
- extracted candidate spec bullets

Raw chat logs are intentionally not stored in this MVP.
