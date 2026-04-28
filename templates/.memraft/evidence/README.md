# Evidence Store

This directory stores compiled evidence views from the local Memraft runtime.

- `latest.json` is the most recent extraction
- `sessions/*.json` stores per-session snapshots

The primary runtime store is `.memraft/state/index.sqlite`. These JSON files are
compatibility and inspection views compiled from that runtime.

Evidence uses only:

- session summary
- changed file list
- quality grade and scoring signals
- extracted memory bullets
- extracted candidate spec bullets

Memraft still does not persist full raw chat logs, but it now stores searchable
summary, rule, transcript-tail, and diff excerpts in SQLite for local recall.
