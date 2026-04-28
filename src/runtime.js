import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MEMRAFT_DIR = ".memraft";
const SHARED_SPEC_ROOT = "memraft";

function resolveRepoRelativePath(repoRoot, relativePath, label) {
  const candidatePath = path.resolve(repoRoot, relativePath);
  const relativeToRoot = path.relative(repoRoot, candidatePath);
  const escapesRoot =
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot);

  if (escapesRoot) {
    throw new Error(`${label} must stay within the repository root (received: ${relativePath})`);
  }

  return candidatePath;
}

export function resolveTargetDir(targetDir) {
  return path.resolve(targetDir ?? process.cwd());
}

function resolveConfiguredMemraftPath(memraftRoot, relativePath, label) {
  const candidatePath = path.resolve(memraftRoot, relativePath);
  const relativeToRoot = path.relative(memraftRoot, candidatePath);
  const escapesRoot =
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot);

  if (escapesRoot) {
    throw new Error(`${label} must stay within ${MEMRAFT_DIR}/ (received: ${relativePath})`);
  }

  return candidatePath;
}

export function getMemraftPaths(targetDir) {
  const repoRoot = resolveTargetDir(targetDir);
  const memraftRoot = path.join(repoRoot, MEMRAFT_DIR);
  const configPath = path.join(memraftRoot, "config.json");
  const config = readJsonIfExists(configPath) ?? {};
  const artifacts =
    config && typeof config === "object" && config.artifacts && typeof config.artifacts === "object"
      ? config.artifacts
      : {};
  const sync =
    config && typeof config === "object" && config.sync && typeof config.sync === "object"
      ? config.sync
      : {};

  return {
    repoRoot,
    memraftRoot,
    configPath,
    compiledStatePath: path.join(memraftRoot, "state", "compiled-state.json"),
    latestEvidencePath: resolveConfiguredMemraftPath(
      memraftRoot,
      typeof artifacts.latestEvidencePath === "string" && artifacts.latestEvidencePath
        ? artifacts.latestEvidencePath
        : "evidence/latest.json",
      "artifacts.latestEvidencePath",
    ),
    mergeIndexPath: path.join(memraftRoot, "state", "merge-index.json"),
    sessionEventsDir: path.join(memraftRoot, "state", "session-events"),
    memoryPath: resolveConfiguredMemraftPath(
      memraftRoot,
      typeof artifacts.memoryPath === "string" && artifacts.memoryPath
        ? artifacts.memoryPath
        : "knowledge/memory.md",
      "artifacts.memoryPath",
    ),
    candidateSpecPath: resolveConfiguredMemraftPath(
      memraftRoot,
      typeof artifacts.candidateSpecPath === "string" && artifacts.candidateSpecPath
        ? artifacts.candidateSpecPath
        : "specs/candidate-spec.md",
      "artifacts.candidateSpecPath",
    ),
    repoProfilePath: resolveConfiguredMemraftPath(
      memraftRoot,
      typeof artifacts.repoProfilePath === "string" && artifacts.repoProfilePath
        ? artifacts.repoProfilePath
        : "state/repo-profile.json",
      "artifacts.repoProfilePath",
    ),
    ruleStorePath: resolveConfiguredMemraftPath(
      memraftRoot,
      typeof artifacts.ruleStorePath === "string" && artifacts.ruleStorePath
        ? artifacts.ruleStorePath
        : "state/rule-store.json",
      "artifacts.ruleStorePath",
    ),
    compiledSpecPath: resolveConfiguredMemraftPath(
      memraftRoot,
      typeof artifacts.compiledSpecPath === "string" && artifacts.compiledSpecPath
        ? artifacts.compiledSpecPath
        : "generated/spec.md",
      "artifacts.compiledSpecPath",
    ),
    sessionStartInjectionPath: resolveConfiguredMemraftPath(
      memraftRoot,
      typeof artifacts.sessionStartInjectionPath === "string" && artifacts.sessionStartInjectionPath
        ? artifacts.sessionStartInjectionPath
        : "generated/inject/session-start.txt",
      "artifacts.sessionStartInjectionPath",
    ),
    toolInjectionPath: resolveConfiguredMemraftPath(
      memraftRoot,
      typeof artifacts.toolInjectionPath === "string" && artifacts.toolInjectionPath
        ? artifacts.toolInjectionPath
        : "generated/inject/tool-task.txt",
      "artifacts.toolInjectionPath",
    ),
    subagentInjectionPath: resolveConfiguredMemraftPath(
      memraftRoot,
      typeof artifacts.subagentInjectionPath === "string" && artifacts.subagentInjectionPath
        ? artifacts.subagentInjectionPath
        : "generated/inject/subagent.txt",
      "artifacts.subagentInjectionPath",
    ),
    syncOutboxDir: resolveConfiguredMemraftPath(
      memraftRoot,
      typeof sync.outboxDir === "string" && sync.outboxDir
        ? sync.outboxDir
        : "sync/outbox",
      "sync.outboxDir",
    ),
    adapterDir: path.join(memraftRoot, "generated", "adapters"),
    adapterManifestPath: path.join(memraftRoot, "generated", "adapters", "manifest.json"),
    runtimeSummaryPath: path.join(memraftRoot, "state", "runtime-summary.json"),
    sqlitePath: path.join(memraftRoot, "state", "index.sqlite"),
    memraftCliPath: path.join(memraftRoot, "hooks", "memraft_cli.mjs"),
    codexAgentsPath: path.join(memraftRoot, "generated", "adapters", "codex", "AGENTS.md"),
    codexConfigPath: path.join(memraftRoot, "generated", "adapters", "codex", "config.toml"),
    codexHooksPath: path.join(memraftRoot, "generated", "adapters", "codex", "hooks.json"),
    geminiContextPath: path.join(memraftRoot, "generated", "adapters", "gemini", "GEMINI.md"),
    opencodeAgentsPath: path.join(memraftRoot, "generated", "adapters", "opencode", "AGENTS.md"),
    opencodeConfigPath: path.join(memraftRoot, "generated", "adapters", "opencode", "opencode.json"),
    opencodePluginPath: path.join(memraftRoot, "generated", "adapters", "opencode", "memraft-auto-capture.js"),
    nativeAgentsPath: path.join(repoRoot, "AGENTS.md"),
    nativeCodexConfigPath: path.join(repoRoot, ".codex", "config.toml"),
    nativeCodexHooksPath: path.join(repoRoot, ".codex", "hooks.json"),
    nativeGeminiPath: path.join(repoRoot, "GEMINI.md"),
    nativeOpencodeConfigPath: path.join(repoRoot, "opencode.json"),
    nativeOpencodePluginPath: path.join(repoRoot, ".opencode", "plugins", "memraft-auto-capture.js"),
    claudeSettingsPath: path.join(repoRoot, ".claude", "settings.json"),
    geminiSettingsPath: path.join(repoRoot, ".gemini", "settings.json"),
    sharedSpecRoot: path.join(repoRoot, SHARED_SPEC_ROOT),
    sharedSpecRegistryPath: resolveRepoRelativePath(
      repoRoot,
      path.join(SHARED_SPEC_ROOT, "registry.json"),
      "sharedSpec.registryPath",
    ),
    sharedSpecBackgroundPath: resolveRepoRelativePath(
      repoRoot,
      path.join(SHARED_SPEC_ROOT, "spec", "background.md"),
      "sharedSpec.backgroundPath",
    ),
    sharedSpecConventionsPath: resolveRepoRelativePath(
      repoRoot,
      path.join(SHARED_SPEC_ROOT, "spec", "conventions.md"),
      "sharedSpec.conventionsPath",
    ),
    sharedSpecWorkflowsPath: resolveRepoRelativePath(
      repoRoot,
      path.join(SHARED_SPEC_ROOT, "spec", "workflows.md"),
      "sharedSpec.workflowsPath",
    ),
  };
}

export function loadSharedSpecRegistry(targetDir) {
  const paths = getMemraftPaths(targetDir);
  const registry = readJsonIfExists(paths.sharedSpecRegistryPath);
  return registry && typeof registry === "object" && !Array.isArray(registry)
    ? registry
    : { version: 1, updatedAt: "", entries: {} };
}

export function summarizeSharedSpec(targetDir) {
  const paths = getMemraftPaths(targetDir);
  const registry = loadSharedSpecRegistry(targetDir);
  const entries =
    registry.entries && typeof registry.entries === "object" && !Array.isArray(registry.entries)
      ? Object.values(registry.entries).filter(
          (value) => value && typeof value === "object" && !Array.isArray(value),
        )
      : [];

  return {
    rootDir: paths.sharedSpecRoot,
    registryPath: paths.sharedSpecRegistryPath,
    registryExists: fs.existsSync(paths.sharedSpecRegistryPath),
    acceptedEntries: entries.length,
    sections: {
      background: {
        path: paths.sharedSpecBackgroundPath,
        exists: fs.existsSync(paths.sharedSpecBackgroundPath),
      },
      conventions: {
        path: paths.sharedSpecConventionsPath,
        exists: fs.existsSync(paths.sharedSpecConventionsPath),
      },
      workflows: {
        path: paths.sharedSpecWorkflowsPath,
        exists: fs.existsSync(paths.sharedSpecWorkflowsPath),
      },
    },
  };
}

export function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to read JSON at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse JSON at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to read text at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function isInitialized(targetDir) {
  const paths = getMemraftPaths(targetDir);
  return fs.existsSync(paths.memraftRoot);
}

export function requireInitialized(targetDir) {
  const paths = getMemraftPaths(targetDir);
  if (!fs.existsSync(paths.memraftRoot)) {
    throw new Error(`No .memraft directory found in ${paths.repoRoot}`);
  }
  return paths;
}

export function loadMergeIndex(targetDir) {
  const paths = getMemraftPaths(targetDir);
  const mergeIndex = readJsonIfExists(paths.mergeIndexPath);

  return {
    knowledge:
      mergeIndex && typeof mergeIndex === "object" && mergeIndex.knowledge
        ? mergeIndex.knowledge
        : {},
    candidateSpec:
      mergeIndex && typeof mergeIndex === "object" && mergeIndex.candidateSpec
        ? mergeIndex.candidateSpec
        : {},
  };
}

export function summarizeCollection(records) {
  const values = Object.values(records ?? {}).filter(
    (value) => value && typeof value === "object",
  );
  let promoted = 0;
  let candidates = 0;
  let invalidated = 0;

  for (const value of values) {
    const lifecycleStatus =
      typeof value.lifecycleStatus === "string" ? value.lifecycleStatus : "active";
    if (lifecycleStatus === "invalidated") {
      invalidated += 1;
      continue;
    }
    const status =
      typeof value.promotionStatus === "string"
        ? value.promotionStatus
        : "candidate";
    if (status === "promoted") {
      promoted += 1;
    } else {
      candidates += 1;
    }
  }

  return {
    total: values.length,
    promoted,
    candidates,
    invalidated,
  };
}

export function summarizeHooks(targetDir) {
  const paths = getMemraftPaths(targetDir);
  const settings = readJsonIfExists(paths.claudeSettingsPath);
  const hooks =
    settings && typeof settings === "object" && settings.hooks
      ? settings.hooks
      : {};

  function hasManagedHook(eventName, moduleName) {
    const matchers = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
    return matchers.some((matcher) => {
      if (!matcher || typeof matcher !== "object") {
        return false;
      }

      const commands = Array.isArray(matcher.hooks) ? matcher.hooks : [];
      return commands.some(
        (hook) =>
          hook &&
          typeof hook === "object" &&
          typeof hook.command === "string" &&
          hook.command.includes("CLAUDE_PROJECT_DIR") &&
          hook.command.includes(moduleName),
      );
    });
  }

  return {
    sessionStart: hasManagedHook("SessionStart", "session_start"),
    preToolUse: hasManagedHook("PreToolUse", "pre_tool_use"),
    stop: hasManagedHook("Stop", "stop"),
    subagentStart: hasManagedHook("SubagentStart", "subagent_start"),
    subagentStop: hasManagedHook("SubagentStop", "subagent_stop"),
    sessionEnd: hasManagedHook("SessionEnd", "session_end"),
  };
}

export function countRuntimeFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== ".gitkeep")
    .length;
}

function parseJsonValue(value, fallback) {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isAdapterEnabled(adapterState) {
  if (!adapterState || typeof adapterState !== "object") {
    return false;
  }
  if (adapterState.ownership === "managed") {
    return true;
  }
  const details =
    adapterState.details && typeof adapterState.details === "object"
      ? adapterState.details
      : {};
  return details.enabled === true;
}

function buildAdapterModesFromStates(adapterStates) {
  const buildMode = (injectEnabled, captureEnabled) => ({
    mode: injectEnabled && captureEnabled ? "full" : injectEnabled ? "inject-only" : captureEnabled ? "capture-only" : "passive",
    injectEnabled,
    captureEnabled,
  });
  return {
    codex: buildMode(
      isAdapterEnabled(adapterStates.nativeAgents),
      isAdapterEnabled(adapterStates.nativeCodexConfig) &&
        isAdapterEnabled(adapterStates.nativeCodexHooks),
    ),
    opencode: buildMode(
      isAdapterEnabled(adapterStates.nativeAgents) &&
        isAdapterEnabled(adapterStates.nativeOpencodeConfig),
      isAdapterEnabled(adapterStates.nativeOpencodeConfig) &&
        isAdapterEnabled(adapterStates.nativeOpencodePlugin),
    ),
    gemini: buildMode(isAdapterEnabled(adapterStates.nativeGemini), false),
  };
}

export function loadSqliteSnapshot(targetDir) {
  const paths = getMemraftPaths(targetDir);
  const emptyCollections = {
    knowledge: { total: 0, promoted: 0, candidates: 0, invalidated: 0 },
    candidateSpec: { total: 0, promoted: 0, candidates: 0, invalidated: 0 },
  };
  if (!fs.existsSync(paths.sqlitePath)) {
    return {
      runtime: null,
      latest: null,
      collections: emptyCollections,
    };
  }
  const db = new DatabaseSync(paths.sqlitePath);
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    const adapterStates = Object.fromEntries(
      db
        .prepare(
          "SELECT adapter_name, ownership, details_json, updated_at FROM adapter_state ORDER BY adapter_name ASC",
        )
        .all()
        .map((row) => [
          row.adapter_name,
          {
            ownership: row.ownership,
            updatedAt: row.updated_at,
            details: parseJsonValue(row.details_json, {}),
          },
        ]),
    );
    const adapterModes = buildAdapterModesFromStates(adapterStates);
    const pendingCountRow = db.prepare("SELECT COUNT(*) AS count FROM memories WHERE promotion_status = 'candidate'").get();
    const eventCountRow = db.prepare("SELECT COUNT(*) AS count FROM events").get();
    const memoryCountRow = db.prepare("SELECT COUNT(*) AS count FROM memories").get();
    const memoryEdgeCountRow = db.prepare("SELECT COUNT(*) AS count FROM memory_edges").get();
    const recentAuditRows = db
      .prepare(
        `
          SELECT created_at, action_type, entity_type, entity_id, details_json
          FROM audit_log
          ORDER BY audit_id DESC
          LIMIT 8
        `,
      )
      .all();
    const activeTaskRow = db
      .prepare(
        `
          SELECT task_id, slug, title, status, is_active, created_at, updated_at, finished_at
          FROM tasks
          WHERE is_active = 1
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        `,
      )
      .get();
    const latestRow = db.prepare("SELECT evidence_json FROM events ORDER BY created_at DESC, event_id DESC LIMIT 1").get();
    const collections = { ...emptyCollections };
    for (const row of db
      .prepare(
        `
          SELECT collection_name, promotion_status, lifecycle_status, COUNT(*) AS count
          FROM memories
          WHERE collection_name IN ('knowledge', 'candidateSpec')
          GROUP BY collection_name, promotion_status, lifecycle_status
        `,
      )
      .all()) {
      const collection = collections[row.collection_name];
      if (!collection) {
        continue;
      }
      const count = Number(row.count);
      collection.total += count;
      if (row.lifecycle_status === "invalidated") {
        collection.invalidated += count;
      } else if (row.promotion_status === "promoted") {
        collection.promoted += count;
      } else {
        collection.candidates += count;
      }
    }
    return {
      runtime: {
        dbPath: paths.sqlitePath,
        eventCount: Number(eventCountRow?.count ?? 0),
        memoryCount: Number(memoryCountRow?.count ?? 0),
        memoryEdgeCount: Number(memoryEdgeCountRow?.count ?? 0),
        pendingPromotionCount: Number(pendingCountRow?.count ?? 0),
        activeTask: activeTaskRow
          ? {
              ...activeTaskRow,
              taskId: activeTaskRow.task_id,
              createdAt: activeTaskRow.created_at,
              updatedAt: activeTaskRow.updated_at,
              finishedAt: activeTaskRow.finished_at,
              isActive: Boolean(activeTaskRow.is_active),
            }
          : null,
        adapterStates,
        adapterModes,
        recentAudit: recentAuditRows.map((row) => ({
          createdAt: row.created_at,
          actionType: row.action_type,
          entityType: row.entity_type,
          entityId: row.entity_id,
          details: parseJsonValue(row.details_json, {}),
        })),
      },
      latest: latestRow ? parseJsonValue(latestRow.evidence_json, {}) : null,
      collections,
    };
  } finally {
    db.close();
  }
}
