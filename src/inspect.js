import fs from "node:fs";
import path from "node:path";
import {
  readJsonIfExists,
  readTextIfExists,
  requireInitialized,
} from "./runtime.js";

function printList(title, values) {
  console.log(title);
  if (!Array.isArray(values) || values.length === 0) {
    console.log("- none");
    console.log("");
    return;
  }

  for (const value of values) {
    console.log(`- ${value}`);
  }
  console.log("");
}

function summarizeEvidenceFile(paths, eventId) {
  const evidencePath = path.join(paths.memraftRoot, "evidence", "sessions", `${eventId}.json`);
  const evidence = readJsonIfExists(evidencePath);
  return {
    eventId,
    path: evidencePath,
    exists: Boolean(evidence),
    evidence: evidence ?? null,
  };
}

function buildRulesInspection(paths) {
  const ruleStore = readJsonIfExists(paths.ruleStorePath);
  if (!ruleStore) {
    throw new Error(`No rule store found in ${paths.ruleStorePath}`);
  }

  return {
    repoRoot: paths.repoRoot,
    ruleStorePath: paths.ruleStorePath,
    ruleStore,
  };
}

function buildCompiledInspection(paths) {
  const files = {
    compiledSpec: paths.compiledSpecPath,
    sessionStartInjection: paths.sessionStartInjectionPath,
    toolInjection: paths.toolInjectionPath,
    subagentInjection: paths.subagentInjectionPath,
    compiledState: paths.compiledStatePath,
    adapterManifest: paths.adapterManifestPath,
    codexAgents: paths.codexAgentsPath,
    codexConfig: paths.codexConfigPath,
    codexHooks: paths.codexHooksPath,
    geminiContext: paths.geminiContextPath,
    opencodeAgents: paths.opencodeAgentsPath,
    opencodeConfig: paths.opencodeConfigPath,
    opencodePlugin: paths.opencodePluginPath,
    nativeAgents: paths.nativeAgentsPath,
    nativeCodexConfig: paths.nativeCodexConfigPath,
    nativeCodexHooks: paths.nativeCodexHooksPath,
    nativeGemini: paths.nativeGeminiPath,
    nativeOpencodeConfig: paths.nativeOpencodeConfigPath,
    nativeOpencodePlugin: paths.nativeOpencodePluginPath,
    sharedRegistry: paths.sharedSpecRegistryPath,
    sharedBackground: paths.sharedSpecBackgroundPath,
    sharedConventions: paths.sharedSpecConventionsPath,
    sharedWorkflows: paths.sharedSpecWorkflowsPath,
  };

  const entries = Object.fromEntries(
    Object.entries(files).map(([key, filePath]) => {
      const content = readTextIfExists(filePath);
      const preview =
        typeof content === "string"
          ? content
              .split(/\r?\n/)
              .filter((line) => line.trim().length > 0)
              .slice(0, 10)
          : [];
      return [
        key,
        {
          path: filePath,
          exists: content !== null,
          size: content === null ? 0 : Buffer.byteLength(content, "utf8"),
          preview,
        },
      ];
    }),
  );

  return {
    repoRoot: paths.repoRoot,
    files: entries,
    manifest: readJsonIfExists(paths.adapterManifestPath),
    compiledState: readJsonIfExists(paths.compiledStatePath),
    runtimeSummary: readJsonIfExists(paths.runtimeSummaryPath),
  };
}

function resolveLineageRecord(ruleStore, fingerprint) {
  const collections = [
    ["knowledge", ruleStore?.collections?.knowledge?.records ?? {}],
    ["spec", ruleStore?.collections?.spec?.records ?? {}],
  ];

  const matches = [];
  for (const [collection, records] of collections) {
    for (const [recordFingerprint, record] of Object.entries(records)) {
      if (!record || typeof record !== "object") {
        continue;
      }
      if (recordFingerprint === fingerprint || recordFingerprint.startsWith(fingerprint)) {
        matches.push({ collection, fingerprint: recordFingerprint, record });
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`No rule record found for fingerprint: ${fingerprint}`);
  }
  if (matches.length > 1) {
    throw new Error(`Fingerprint prefix is ambiguous: ${fingerprint}`);
  }
  return matches[0];
}

function buildLineageInspection(paths, fingerprint) {
  const ruleStore = readJsonIfExists(paths.ruleStorePath);
  if (!ruleStore) {
    throw new Error(`No rule store found in ${paths.ruleStorePath}`);
  }

  const match = resolveLineageRecord(ruleStore, fingerprint);
  const sourceEvidenceIds = Array.isArray(match.record.sourceEvidenceIds)
    ? match.record.sourceEvidenceIds.filter((value) => typeof value === "string")
    : [];

  return {
    repoRoot: paths.repoRoot,
    collection: match.collection,
    fingerprint: match.fingerprint,
    record: match.record,
    evidence: sourceEvidenceIds.map((eventId) => summarizeEvidenceFile(paths, eventId)),
  };
}

export async function inspectLatest(options = {}) {
  const paths = requireInitialized(options.targetDir);
  const latest = readJsonIfExists(paths.latestEvidencePath);

  if (!latest) {
    throw new Error(`No latest evidence found in ${paths.latestEvidencePath}`);
  }

  if (options.json) {
    console.log(JSON.stringify(latest, null, 2));
    return;
  }

  const quality =
    latest.quality && typeof latest.quality === "object" ? latest.quality : {};
  const source =
    latest.source && typeof latest.source === "object" ? latest.source : {};
  const merge =
    latest.merge && typeof latest.merge === "object" ? latest.merge : {};

  console.log("Latest Evidence");
  console.log("");
  console.log(`Event: ${latest.eventId ?? "unknown"}`);
  console.log(`CreatedAt: ${latest.createdAt ?? "unknown"}`);
  console.log(`Session: ${latest.sessionId ?? "unknown"}`);
  console.log(`Reason: ${latest.reason ?? "unknown"}`);
  console.log(`Generator: ${latest.generator ?? "unknown"}`);
  console.log("");
  console.log("Quality:");
  console.log(`- grade: ${quality.grade ?? "N/A"}`);
  console.log(`- score: ${quality.score ?? "N/A"}`);
  console.log(
    `- transcriptChars: ${source.transcriptChars ?? quality.transcriptChars ?? 0}`,
  );
  console.log(`- diffChars: ${source.diffChars ?? quality.diffChars ?? 0}`);
  console.log("");
  console.log("Summary:");
  console.log(typeof latest.summary === "string" ? latest.summary : "(empty)");
  console.log("");
  printList("Files:", Array.isArray(latest.files) ? latest.files : []);
  printList(
    "Knowledge:",
    Array.isArray(latest.knowledge) ? latest.knowledge : [],
  );
  printList(
    "Candidate Spec:",
    Array.isArray(latest.candidateSpec) ? latest.candidateSpec : [],
  );
  console.log("Merge:");
  console.log(`- eligible: ${merge.eligible ?? false}`);
  console.log(`- minimumGrade: ${merge.minimumGrade ?? "N/A"}`);
  console.log(
    `- knowledge: ${JSON.stringify(merge.knowledge ?? {}, null, 0)}`,
  );
  console.log(
    `- candidateSpec: ${JSON.stringify(merge.candidateSpec ?? {}, null, 0)}`,
  );
}

export async function inspectRules(options = {}) {
  const paths = requireInitialized(options.targetDir);
  const inspection = buildRulesInspection(paths);

  if (options.json) {
    console.log(JSON.stringify(inspection, null, 2));
    return;
  }

  const { ruleStore } = inspection;
  console.log("Rule Store");
  console.log("");
  console.log(`Path: ${inspection.ruleStorePath}`);
  console.log(`Schema: ${ruleStore.recordSchemaVersion ?? 1}`);
  console.log(`UpdatedAt: ${ruleStore.updatedAt ?? "unknown"}`);
  console.log("");

  for (const [name, collection] of Object.entries(ruleStore.collections ?? {})) {
    const label = name === "spec" ? "Spec" : "Knowledge";
    console.log(`${label}:`);
    console.log(`- promoted: ${collection.promotedCount ?? 0}`);
    console.log(`- candidates: ${collection.candidateCount ?? 0}`);
    console.log(`- invalidated: ${collection.invalidatedCount ?? 0}`);
    console.log(`- kinds: ${JSON.stringify(collection.kindCounts ?? {}, null, 0)}`);
    console.log(`- scopes: ${JSON.stringify(collection.scopeCounts ?? {}, null, 0)}`);
    console.log("");
  }
}

export async function inspectCompiled(options = {}) {
  const paths = requireInitialized(options.targetDir);
  const inspection = buildCompiledInspection(paths);

  if (options.json) {
    console.log(JSON.stringify(inspection, null, 2));
    return;
  }

  console.log("Compiled Artifacts");
  console.log("");
  console.log(`Repo: ${inspection.repoRoot}`);
  console.log("");

  for (const [name, info] of Object.entries(inspection.files)) {
    console.log(`${name}:`);
    console.log(`- path: ${info.path}`);
    console.log(`- exists: ${info.exists}`);
    console.log(`- size: ${info.size}`);
    if (Array.isArray(info.preview) && info.preview.length > 0) {
      console.log("- preview:");
      for (const line of info.preview) {
        console.log(`  ${line}`);
      }
    }
    console.log("");
  }

  const runtimeSummary =
    inspection.runtimeSummary && typeof inspection.runtimeSummary === "object"
      ? inspection.runtimeSummary
      : null;
  if (runtimeSummary) {
    const adapterStates =
      runtimeSummary.adapterStates && typeof runtimeSummary.adapterStates === "object"
        ? runtimeSummary.adapterStates
        : {};
    const adapterModes =
      runtimeSummary.adapterModes && typeof runtimeSummary.adapterModes === "object"
        ? runtimeSummary.adapterModes
        : {};
    console.log("Runtime:");
    console.log(`- pending promotions: ${runtimeSummary.pendingPromotionCount ?? 0}`);
    console.log(`- memory edges: ${runtimeSummary.memoryEdgeCount ?? 0}`);
    console.log(`- adapters tracked: ${Object.keys(adapterStates).length}`);
    for (const [name, state] of Object.entries(adapterStates)) {
      if (!state || typeof state !== "object") {
        continue;
      }
      console.log(`- ${name}: ${state.ownership ?? "unknown"}`);
    }
    for (const [name, state] of Object.entries(adapterModes)) {
      if (!state || typeof state !== "object") {
        continue;
      }
      console.log(`- mode ${name}: ${state.mode ?? "unknown"}`);
    }
    console.log("");
  }
}

export async function inspectLineage(options = {}) {
  const paths = requireInitialized(options.targetDir);
  if (typeof options.fingerprint !== "string" || !options.fingerprint.trim()) {
    throw new Error("inspect lineage requires a fingerprint");
  }

  const inspection = buildLineageInspection(paths, options.fingerprint.trim());
  if (options.json) {
    console.log(JSON.stringify(inspection, null, 2));
    return;
  }

  console.log("Rule Lineage");
  console.log("");
  console.log(`Collection: ${inspection.collection}`);
  console.log(`Fingerprint: ${inspection.fingerprint}`);
  console.log(`Text: ${inspection.record.text ?? ""}`);
  console.log(`Kind: ${inspection.record.kind ?? "unknown"}`);
  console.log(`Scope: ${inspection.record.scope ?? "unknown"}`);
  console.log(`Promotion: ${inspection.record.promotionStatus ?? "unknown"}`);
  console.log(`Lifecycle: ${inspection.record.lifecycleStatus ?? "active"}`);
  console.log(`Paths: ${JSON.stringify(inspection.record.paths ?? [], null, 0)}`);
  console.log(`Requires: ${JSON.stringify(inspection.record.requires ?? {}, null, 0)}`);
  console.log("");

  console.log("Evidence:");
  if (inspection.evidence.length === 0) {
    console.log("- none");
    return;
  }

  for (const entry of inspection.evidence) {
    const evidence = entry.evidence ?? {};
    const quality =
      evidence.quality && typeof evidence.quality === "object" ? evidence.quality : {};
    console.log(`- ${entry.eventId}: ${entry.path}`);
    console.log(`  exists=${entry.exists} generator=${evidence.generator ?? "unknown"} grade=${quality.grade ?? "N/A"}`);
    if (typeof evidence.summary === "string" && evidence.summary) {
      console.log(`  summary=${evidence.summary}`);
    }
  }
}
