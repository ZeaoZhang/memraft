# TeamAI Sync Protocol v1

This file defines the local outbox envelope written by the TeamAI session-end
worker. The protocol is designed so a later client can upload envelopes to a
shared service without changing extraction behavior.

## Envelope Shape

```json
{
  "protocolVersion": 1,
  "eventType": "session_evidence",
  "eventId": "20260326T120001Z_ab12cd34",
  "createdAt": "2026-03-26T12:00:01Z",
  "repo": {
    "key": "my-repo",
    "name": "my-repo",
    "scope": "repo",
    "publicNamespaces": ["shared/default"]
  },
  "session": {
    "id": "session-123",
    "reason": "other"
  },
  "evidence": {
    "summary": "Short summary",
    "files": ["src/app.ts"],
    "generator": "claude",
    "quality": {
      "grade": "B",
      "score": 78,
      "signals": ["transcript", "diff", "model_summary"]
    }
  },
  "artifacts": {
    "knowledge": ["Stable reusable knowledge"],
    "candidateSpec": ["Candidate convention"]
  },
  "merge": {
    "minimumGrade": "C",
    "eligible": true,
    "promotion": {
      "minimumOccurrences": 2,
      "minimumEvidenceCount": 2,
      "minimumConfidence": 0.68
    },
    "knowledge": {
      "added": 1,
      "updated": 0,
      "skipped": 0,
      "promoted": 1,
      "currentPromoted": 4,
      "currentCandidates": 7
    },
    "candidateSpec": {
      "added": 1,
      "updated": 0,
      "skipped": 0,
      "promoted": 0,
      "currentPromoted": 1,
      "currentCandidates": 3
    }
  }
}
```

## Conflict Rule

- The canonical identity of a bullet is its normalized fingerprint.
- If the same fingerprint appears again, the higher-quality version wins.
- If quality ties, the longer non-empty text wins.
- Occurrence count and last-seen timestamp are always updated.
- Confidence rises from repeated evidence plus evidence quality.
- Only entries that meet the configured promotion thresholds should be injected.

## Delivery Model

- TeamAI writes envelopes to `sync/outbox/`.
- Upload is intentionally decoupled from extraction.
- A future sync client should treat outbox files as append-only input and only
  remove them after receiving a durable server acknowledgement.
