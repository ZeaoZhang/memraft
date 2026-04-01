import fs from "node:fs";
import path from "node:path";

const TEAMAI_DIR = ".teamai";

export function resolveTargetDir(targetDir) {
  return path.resolve(targetDir ?? process.cwd());
}

function resolveConfiguredTeamaiPath(teamaiRoot, relativePath, label) {
  const candidatePath = path.resolve(teamaiRoot, relativePath);
  const relativeToRoot = path.relative(teamaiRoot, candidatePath);
  const escapesRoot =
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot);

  if (escapesRoot) {
    throw new Error(`${label} must stay within ${TEAMAI_DIR}/ (received: ${relativePath})`);
  }

  return candidatePath;
}

export function getTeamaiPaths(targetDir) {
  const repoRoot = resolveTargetDir(targetDir);
  const teamaiRoot = path.join(repoRoot, TEAMAI_DIR);
  const configPath = path.join(teamaiRoot, "config.json");
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
    teamaiRoot,
    configPath,
    compiledStatePath: path.join(teamaiRoot, "state", "compiled-state.json"),
    latestEvidencePath: resolveConfiguredTeamaiPath(
      teamaiRoot,
      typeof artifacts.latestEvidencePath === "string" && artifacts.latestEvidencePath
        ? artifacts.latestEvidencePath
        : "evidence/latest.json",
      "artifacts.latestEvidencePath",
    ),
    mergeIndexPath: path.join(teamaiRoot, "state", "merge-index.json"),
    sessionEventsDir: path.join(teamaiRoot, "state", "session-events"),
    memoryPath: resolveConfiguredTeamaiPath(
      teamaiRoot,
      typeof artifacts.memoryPath === "string" && artifacts.memoryPath
        ? artifacts.memoryPath
        : "knowledge/memory.md",
      "artifacts.memoryPath",
    ),
    candidateSpecPath: resolveConfiguredTeamaiPath(
      teamaiRoot,
      typeof artifacts.candidateSpecPath === "string" && artifacts.candidateSpecPath
        ? artifacts.candidateSpecPath
        : "specs/candidate-spec.md",
      "artifacts.candidateSpecPath",
    ),
    repoProfilePath: resolveConfiguredTeamaiPath(
      teamaiRoot,
      typeof artifacts.repoProfilePath === "string" && artifacts.repoProfilePath
        ? artifacts.repoProfilePath
        : "state/repo-profile.json",
      "artifacts.repoProfilePath",
    ),
    ruleStorePath: resolveConfiguredTeamaiPath(
      teamaiRoot,
      typeof artifacts.ruleStorePath === "string" && artifacts.ruleStorePath
        ? artifacts.ruleStorePath
        : "state/rule-store.json",
      "artifacts.ruleStorePath",
    ),
    compiledSpecPath: resolveConfiguredTeamaiPath(
      teamaiRoot,
      typeof artifacts.compiledSpecPath === "string" && artifacts.compiledSpecPath
        ? artifacts.compiledSpecPath
        : "generated/spec.md",
      "artifacts.compiledSpecPath",
    ),
    sessionStartInjectionPath: resolveConfiguredTeamaiPath(
      teamaiRoot,
      typeof artifacts.sessionStartInjectionPath === "string" && artifacts.sessionStartInjectionPath
        ? artifacts.sessionStartInjectionPath
        : "generated/inject/session-start.txt",
      "artifacts.sessionStartInjectionPath",
    ),
    toolInjectionPath: resolveConfiguredTeamaiPath(
      teamaiRoot,
      typeof artifacts.toolInjectionPath === "string" && artifacts.toolInjectionPath
        ? artifacts.toolInjectionPath
        : "generated/inject/tool-task.txt",
      "artifacts.toolInjectionPath",
    ),
    subagentInjectionPath: resolveConfiguredTeamaiPath(
      teamaiRoot,
      typeof artifacts.subagentInjectionPath === "string" && artifacts.subagentInjectionPath
        ? artifacts.subagentInjectionPath
        : "generated/inject/subagent.txt",
      "artifacts.subagentInjectionPath",
    ),
    syncOutboxDir: resolveConfiguredTeamaiPath(
      teamaiRoot,
      typeof sync.outboxDir === "string" && sync.outboxDir
        ? sync.outboxDir
        : "sync/outbox",
      "sync.outboxDir",
    ),
    adapterDir: path.join(teamaiRoot, "generated", "adapters"),
    adapterManifestPath: path.join(teamaiRoot, "generated", "adapters", "manifest.json"),
    codexAgentsPath: path.join(teamaiRoot, "generated", "adapters", "codex", "AGENTS.md"),
    geminiContextPath: path.join(teamaiRoot, "generated", "adapters", "gemini", "GEMINI.md"),
    opencodeAgentsPath: path.join(teamaiRoot, "generated", "adapters", "opencode", "AGENTS.md"),
    opencodeConfigPath: path.join(teamaiRoot, "generated", "adapters", "opencode", "opencode.json"),
    claudeSettingsPath: path.join(repoRoot, ".claude", "settings.json"),
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
  const paths = getTeamaiPaths(targetDir);
  return fs.existsSync(paths.teamaiRoot);
}

export function requireInitialized(targetDir) {
  const paths = getTeamaiPaths(targetDir);
  if (!fs.existsSync(paths.teamaiRoot)) {
    throw new Error(`No .teamai directory found in ${paths.repoRoot}`);
  }
  return paths;
}

export function loadMergeIndex(targetDir) {
  const paths = getTeamaiPaths(targetDir);
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
  const paths = getTeamaiPaths(targetDir);
  const settings = readJsonIfExists(paths.claudeSettingsPath);
  const hooks =
    settings && typeof settings === "object" && settings.hooks
      ? settings.hooks
      : {};

  function hasCommand(eventName, needle) {
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
          hook.command.includes(needle),
      );
    });
  }

  return {
    sessionStart: hasCommand("SessionStart", ".teamai/hooks/session_start.py"),
    preToolUse: hasCommand("PreToolUse", ".teamai/hooks/pre_tool_use.py"),
    stop: hasCommand("Stop", ".teamai/hooks/stop.py"),
    subagentStart: hasCommand("SubagentStart", ".teamai/hooks/subagent_start.py"),
    subagentStop: hasCommand("SubagentStop", ".teamai/hooks/subagent_stop.py"),
    sessionEnd: hasCommand("SessionEnd", ".teamai/hooks/session_end.py"),
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
