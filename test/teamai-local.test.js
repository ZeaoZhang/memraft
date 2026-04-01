import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const PROJECT_ROOT = "/Users/zhangzeao/workspace/workspace/teamai-local-mvp";
const CLI_PATH = path.join(PROJECT_ROOT, "bin", "teamai-local.js");
const SUMMARY_AGENT_NAME = "teamai-memory-summarizer";

function makeRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "teamai-local-test-"));
  const repo = path.join(root, "repo");
  mkdirSync(repo, { recursive: true });

  const gitInit = spawnSync("git", ["init"], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.equal(gitInit.status, 0, gitInit.stderr);

  return repo;
}

function runCli(args, { expectSuccess = true } = {}) {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
  });

  if (expectSuccess) {
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  return result;
}

function resolveProjectDir(startDir) {
  let current = path.resolve(startDir);

  for (;;) {
    if (existsSync(path.join(current, ".git")) || existsSync(path.join(current, ".teamai"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readTeamaiConfig(repo) {
  return readJson(path.join(repo, ".teamai", "config.json"));
}

function getConfiguredTeamaiPath(repo, relativePath, fallback) {
  const nextRelativePath =
    typeof relativePath === "string" && relativePath ? relativePath : fallback;
  return path.resolve(repo, ".teamai", nextRelativePath);
}

function getLatestEvidencePath(repo) {
  const config = readTeamaiConfig(repo);
  return getConfiguredTeamaiPath(
    repo,
    config.artifacts?.latestEvidencePath,
    "evidence/latest.json",
  );
}

function getSyncOutboxDir(repo) {
  const config = readTeamaiConfig(repo);
  return getConfiguredTeamaiPath(
    repo,
    config.sync?.outboxDir,
    "sync/outbox",
  );
}

function getRepoProfilePath(repo) {
  const config = readTeamaiConfig(repo);
  return getConfiguredTeamaiPath(
    repo,
    config.artifacts?.repoProfilePath,
    "state/repo-profile.json",
  );
}

function getRuleStorePath(repo) {
  const config = readTeamaiConfig(repo);
  return getConfiguredTeamaiPath(
    repo,
    config.artifacts?.ruleStorePath,
    "state/rule-store.json",
  );
}

function getCompiledSpecPath(repo) {
  const config = readTeamaiConfig(repo);
  return getConfiguredTeamaiPath(
    repo,
    config.artifacts?.compiledSpecPath,
    "generated/spec.md",
  );
}

function getCompiledStatePath(repo) {
  return path.join(repo, ".teamai", "state", "compiled-state.json");
}

function getAdapterManifestPath(repo) {
  return path.join(repo, ".teamai", "generated", "adapters", "manifest.json");
}

function getCodexAgentsPath(repo) {
  return path.join(repo, ".teamai", "generated", "adapters", "codex", "AGENTS.md");
}

function getGeminiContextPath(repo) {
  return path.join(repo, ".teamai", "generated", "adapters", "gemini", "GEMINI.md");
}

function getOpenCodeAgentsPath(repo) {
  return path.join(repo, ".teamai", "generated", "adapters", "opencode", "AGENTS.md");
}

function getOpenCodeConfigPath(repo) {
  return path.join(repo, ".teamai", "generated", "adapters", "opencode", "opencode.json");
}

function getSessionInjectionPath(repo) {
  const config = readTeamaiConfig(repo);
  return getConfiguredTeamaiPath(
    repo,
    config.artifacts?.sessionStartInjectionPath,
    "generated/inject/session-start.txt",
  );
}

function getToolInjectionPath(repo) {
  const config = readTeamaiConfig(repo);
  return getConfiguredTeamaiPath(
    repo,
    config.artifacts?.toolInjectionPath,
    "generated/inject/tool-task.txt",
  );
}

function runHookCommand(command, { cwd, input = "{}" }) {
  const projectDir = resolveProjectDir(cwd);
  if (process.platform === "win32") {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", command], {
      cwd,
      encoding: "utf8",
      input,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });
  }

  return spawnSync("sh", ["-lc", command], {
    cwd,
    encoding: "utf8",
    input,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
}

function runJsonHook(command, { cwd, inputData = {} }) {
  const result = runHookCommand(command, {
    cwd,
    input: JSON.stringify(inputData),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function getFirstHook(settings, eventName) {
  const entries = settings.hooks[eventName];
  assert.ok(Array.isArray(entries) && entries.length > 0, `missing ${eventName}`);
  const hooks = entries[0].hooks;
  assert.ok(Array.isArray(hooks) && hooks.length > 0, `missing ${eventName} hook command`);
  return hooks[0];
}

function getFirstHookCommand(settings, eventName) {
  return getFirstHook(settings, eventName).command;
}

function seedWorktree(repo) {
  mkdirSync(path.join(repo, "src"), { recursive: true });
  writeFileSync(path.join(repo, "src", "app.js"), "export const app = 1;\n", "utf8");

  mkdirSync(path.join(repo, ".omc"), { recursive: true });
  writeFileSync(path.join(repo, ".omc", "project-memory.json"), "{}\n", "utf8");
}

function completeStopSummary(repo, sessionId, options = {}) {
  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const stopCommand = getFirstHookCommand(settings, "Stop");
  const subagentStartCommand = getFirstHookCommand(settings, "SubagentStart");
  const subagentStopCommand = getFirstHookCommand(settings, "SubagentStop");
  const assistantMessage =
    "This is a detailed assistant response about the completed work. ".repeat(12);
  const summaryPayload = options.summaryPayload ?? {
    summary: "Stable summary.",
    knowledge: ["src/app.js is part of the project runtime surface"],
    candidate_spec: ["Keep TeamAI summaries JSON-only and subagent-driven"],
  };

  const stopOutput = runJsonHook(stopCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      session_id: sessionId,
      last_assistant_message: assistantMessage,
    },
  });

  const startOutput = runJsonHook(subagentStartCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      session_id: sessionId,
      subagent_type: SUMMARY_AGENT_NAME,
      subagent_id: "agent-1",
    },
  });

  if (typeof options.beforeSubagentStop === "function") {
    options.beforeSubagentStop();
  }

  const stopSubagentOutput = runJsonHook(subagentStopCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      session_id: sessionId,
      subagent_type: SUMMARY_AGENT_NAME,
      subagent_id: "agent-1",
      last_assistant_message: JSON.stringify(summaryPayload),
    },
  });

  return {
    stopOutput,
    startOutput,
    stopSubagentOutput,
    latest: readJson(getLatestEvidencePath(repo)),
    summaryState: readJson(path.join(repo, ".teamai", "state", "summary-state.json")),
  };
}

test("init writes stable hook settings, installs the summary subagent, and hook commands work from subdirectories", () => {
  const repo = makeRepo();
  runCli(["init", repo]);

  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const sessionStartMatchers = settings.hooks.SessionStart.map((entry) => entry.matcher);
  const sessionEndMatchers = settings.hooks.SessionEnd.map((entry) => entry.matcher);
  const subagentStartMatchers = settings.hooks.SubagentStart.map((entry) => entry.matcher);
  const subagentStopMatchers = settings.hooks.SubagentStop.map((entry) => entry.matcher);

  assert.deepEqual(
    sessionStartMatchers,
    ["startup", "resume", "clear", "compact"],
  );
  assert.deepEqual(
    sessionEndMatchers,
    [
      "clear",
      "resume",
      "logout",
      "prompt_input_exit",
      "bypass_permissions_disabled",
      "other",
    ],
  );
  assert.deepEqual(subagentStartMatchers, [SUMMARY_AGENT_NAME]);
  assert.deepEqual(subagentStopMatchers, [SUMMARY_AGENT_NAME]);
  assert.equal(settings.hooks.Stop.length, 1);
  assert.ok(!Object.hasOwn(settings.hooks.Stop[0], "matcher"));
  assert.equal(getFirstHook(settings, "Stop").timeout, 10);
  assert.equal(getFirstHook(settings, "SessionEnd").timeout, 10);

  if (process.platform === "win32") {
    assert.equal(getFirstHook(settings, "Stop").shell, "powershell");
  } else {
    assert.ok(!Object.hasOwn(getFirstHook(settings, "Stop"), "shell"));
  }

  const sessionStartCommand = getFirstHookCommand(settings, "SessionStart");
  assert.match(sessionStartCommand, /CLAUDE_PROJECT_DIR/);
  assert.match(sessionStartCommand, /session_start/);
  assert.doesNotMatch(sessionStartCommand, new RegExp(escapeRegExp(repo)));

  assert.ok(
    existsSync(path.join(repo, ".claude", "agents", "teamai-memory-summarizer.md")),
  );

  const subdir = path.join(repo, "nested", "workspace");
  mkdirSync(subdir, { recursive: true });
  const hookOutput = runJsonHook(sessionStartCommand, {
    cwd: subdir,
    inputData: { cwd: subdir },
  });
  assert.equal(hookOutput.hookSpecificOutput.hookEventName, "SessionStart");
});

test("init --skip-existing upgrades existing TeamAI hook commands and timeouts", () => {
  const repo = makeRepo();
  runCli(["init", repo]);

  const settingsPath = path.join(repo, ".claude", "settings.json");
  const settings = readJson(settingsPath);
  settings.hooks.SessionStart[0].hooks[0] = {
    type: "command",
    command: `python3 ${JSON.stringify(path.join(repo, ".teamai", "hooks", "session_start.py"))}`,
    timeout: 99,
  };
  settings.hooks.SessionEnd[0].hooks[0] = {
    type: "command",
    command: `python3 ${JSON.stringify(path.join(repo, ".teamai", "hooks", "session_end.py"))}`,
    timeout: 1,
    shell: "bash",
  };
  writeJson(settingsPath, settings);

  runCli(["init", repo, "--skip-existing"]);

  const nextSettings = readJson(settingsPath);
  const sessionStartHook = nextSettings.hooks.SessionStart[0].hooks[0];
  const sessionEndHook = nextSettings.hooks.SessionEnd[0].hooks[0];
  assert.equal(sessionStartHook.timeout, 10);
  assert.equal(sessionEndHook.timeout, 10);
  assert.match(sessionStartHook.command, /CLAUDE_PROJECT_DIR/);
  assert.match(sessionStartHook.command, /session_start/);
  assert.match(sessionEndHook.command, /CLAUDE_PROJECT_DIR/);
  assert.match(sessionEndHook.command, /session_end/);
  assert.equal(
    nextSettings.hooks.SessionStart[0].hooks.filter((hook) => /session_start/.test(hook.command)).length,
    1,
  );
  assert.equal(
    nextSettings.hooks.SessionEnd[0].hooks.filter((hook) => /session_end/.test(hook.command)).length,
    1,
  );

  if (process.platform === "win32") {
    assert.equal(sessionEndHook.shell, "powershell");
  } else {
    assert.ok(!Object.hasOwn(sessionEndHook, "shell"));
  }
});

test("init requires an explicit overwrite strategy once TeamAI files already exist", () => {
  const repo = makeRepo();
  runCli(["init", repo]);

  const memoryPath = path.join(repo, ".teamai", "knowledge", "memory.md");
  writeFileSync(memoryPath, "custom memory\n", "utf8");

  const rerun = runCli(["init", repo], { expectSuccess: false });
  assert.notEqual(rerun.status, 0);
  assert.match(rerun.stderr, /--skip-existing|--force/);
  assert.equal(readFileSync(memoryPath, "utf8"), "custom memory\n");

  runCli(["init", repo, "--skip-existing"]);
  assert.equal(readFileSync(memoryPath, "utf8"), "custom memory\n");

  runCli(["init", repo, "--force"]);
  assert.match(readFileSync(memoryPath, "utf8"), /# Shared Knowledge Memory/);
});

test("session_start compiles repo profile and injectable context automatically", () => {
  const repo = makeRepo();
  writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify(
      {
        name: "demo-repo",
        packageManager: "pnpm@9.0.0",
        scripts: {
          dev: "vite",
          test: "vitest run",
          lint: "biome check .",
        },
        dependencies: {
          react: "^19.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
          vitest: "^2.0.0",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(path.join(repo, "tsconfig.json"), "{\n  \"compilerOptions\": {}\n}\n", "utf8");
  writeFileSync(path.join(repo, "biome.json"), "{\n  \"linter\": {}\n}\n", "utf8");

  runCli(["init", repo]);

  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const sessionStartCommand = getFirstHookCommand(settings, "SessionStart");
  const output = runJsonHook(sessionStartCommand, {
    cwd: repo,
    inputData: { cwd: repo },
  });

  const repoProfile = readJson(getRepoProfilePath(repo));
  const ruleStore = readJson(getRuleStorePath(repo));
  const compiledSpec = readFileSync(getCompiledSpecPath(repo), "utf8");
  const compiledInjection = readFileSync(getSessionInjectionPath(repo), "utf8");

  assert.equal(repoProfile.workspaceType, "single-package");
  assert.ok(repoProfile.languages.includes("typescript"));
  assert.ok(repoProfile.packageManagers.includes("pnpm"));
  assert.ok(repoProfile.frameworks.includes("React"));
  assert.ok(repoProfile.tooling.includes("Biome"));
  assert.equal(repoProfile.commands.test, "vitest run");

  assert.equal(ruleStore.collections.knowledge.promotedCount, 0);
  assert.equal(ruleStore.collections.spec.promotedCount, 0);
  assert.match(compiledSpec, /## Repository Background/);
  assert.match(compiledSpec, /Languages: javascript, typescript/i);
  assert.match(compiledInjection, /Stable Project Rules/);
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /Repository Background/,
  );
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /Package managers: pnpm/,
  );

  const statusResult = runCli(["status", repo, "--json"]);
  const status = JSON.parse(statusResult.stdout);
  assert.equal(status.generated.repoProfile, true);
  assert.equal(status.generated.ruleStore, true);
  assert.equal(status.generated.compiledSpec, true);
});

test("session_start skips recompilation when compiled inputs are unchanged", async () => {
  const repo = makeRepo();
  seedWorktree(repo);
  runCli(["init", repo]);

  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const sessionStartCommand = getFirstHookCommand(settings, "SessionStart");

  runJsonHook(sessionStartCommand, {
    cwd: repo,
    inputData: { cwd: repo },
  });

  const compiledSpecPath = getCompiledSpecPath(repo);
  const compiledStatePath = getCompiledStatePath(repo);
  const firstSpecStat = statSync(compiledSpecPath);
  const firstCompiledState = readJson(compiledStatePath);

  await new Promise((resolve) => setTimeout(resolve, 25));

  runJsonHook(sessionStartCommand, {
    cwd: repo,
    inputData: { cwd: repo },
  });

  const secondSpecStat = statSync(compiledSpecPath);
  const secondCompiledState = readJson(compiledStatePath);

  assert.equal(secondSpecStat.mtimeMs, firstSpecStat.mtimeMs);
  assert.equal(secondCompiledState.inputHash, firstCompiledState.inputHash);
});

test("promoted rules are compiled into generated spec and tool injection", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const configPath = path.join(repo, ".teamai", "config.json");
  const config = readJson(configPath);
  config.merge.minimumGrade = "D";
  config.merge.promotion.minimumOccurrences = 1;
  config.merge.promotion.minimumEvidenceCount = 1;
  config.merge.promotion.minimumConfidence = 0;
  writeJson(configPath, config);

  const { latest } = completeStopSummary(repo, "sess-promoted");
  const ruleStore = readJson(getRuleStorePath(repo));
  const compiledSpec = readFileSync(getCompiledSpecPath(repo), "utf8");
  const toolInjection = readFileSync(getToolInjectionPath(repo), "utf8");

  assert.equal(ruleStore.collections.knowledge.promotedCount, 1);
  assert.equal(ruleStore.collections.spec.promotedCount, 1);
  assert.match(
    compiledSpec,
    /Keep TeamAI summaries JSON-only and subagent-driven/,
  );
  assert.match(
    compiledSpec,
    /src\/app\.js is part of the project runtime surface/,
  );
  assert.match(toolInjection, /Stable project rules:/);
  assert.match(
    toolInjection,
    /Keep TeamAI summaries JSON-only and subagent-driven/,
  );
  assert.match(toolInjection, /Recent evidence:/);
  assert.equal(latest.merge.eligible, true);
});

test("rule store exports typed metadata for promoted records", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const configPath = path.join(repo, ".teamai", "config.json");
  const config = readJson(configPath);
  config.merge.minimumGrade = "D";
  config.merge.promotion.minimumOccurrences = 1;
  config.merge.promotion.minimumEvidenceCount = 1;
  config.merge.promotion.minimumConfidence = 0;
  writeJson(configPath, config);

  const { latest } = completeStopSummary(repo, "sess-typed", {
    summaryPayload: {
      summary: "Stable summary.",
      knowledge: ["src/app.js is part of the project runtime surface."],
      candidate_spec: ["src/app.js should stay on the project runtime surface."],
    },
  });

  const ruleStore = readJson(getRuleStorePath(repo));
  assert.equal(ruleStore.recordSchemaVersion, 2);
  assert.equal(ruleStore.collections.knowledge.invalidatedCount, 0);
  assert.equal(ruleStore.collections.spec.invalidatedCount, 0);

  const knowledgeRecord = Object.values(ruleStore.collections.knowledge.records).find(
    (record) => record.text === "src/app.js is part of the project runtime surface.",
  );
  const specRecord = Object.values(ruleStore.collections.spec.records).find(
    (record) => record.text === "src/app.js should stay on the project runtime surface.",
  );

  assert.equal(knowledgeRecord.collection, "knowledge");
  assert.equal(knowledgeRecord.kind, "path-fact");
  assert.equal(knowledgeRecord.scope, "path");
  assert.deepEqual(knowledgeRecord.paths, ["src/app.js"]);
  assert.deepEqual(knowledgeRecord.sourceEvidenceIds, [latest.eventId]);
  assert.equal(knowledgeRecord.lifecycleStatus, "active");

  assert.equal(specRecord.collection, "candidateSpec");
  assert.equal(specRecord.kind, "path-rule");
  assert.equal(specRecord.scope, "path");
  assert.deepEqual(specRecord.paths, ["src/app.js"]);
  assert.deepEqual(specRecord.sourceEvidenceIds, [latest.eventId]);
  assert.equal(specRecord.lifecycleStatus, "active");
});

test("compiled adapters are generated for codex, gemini, and opencode", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const configPath = path.join(repo, ".teamai", "config.json");
  const config = readJson(configPath);
  config.merge.minimumGrade = "D";
  config.merge.promotion.minimumOccurrences = 1;
  config.merge.promotion.minimumEvidenceCount = 1;
  config.merge.promotion.minimumConfidence = 0;
  writeJson(configPath, config);

  completeStopSummary(repo, "sess-adapters");

  const manifest = readJson(getAdapterManifestPath(repo));
  const codexAgents = readFileSync(getCodexAgentsPath(repo), "utf8");
  const geminiContext = readFileSync(getGeminiContextPath(repo), "utf8");
  const opencodeAgents = readFileSync(getOpenCodeAgentsPath(repo), "utf8");
  const opencodeConfig = readJson(getOpenCodeConfigPath(repo));

  assert.equal(manifest.adapters.codex.recommendedProjectFile, "AGENTS.md");
  assert.equal(manifest.adapters.gemini.recommendedProjectFile, "GEMINI.md");
  assert.equal(manifest.adapters.opencode.recommendedProjectFile, "AGENTS.md");
  assert.match(codexAgents, /TeamAI Project Context For Codex/);
  assert.match(codexAgents, /Keep TeamAI summaries JSON-only and subagent-driven/);
  assert.match(geminiContext, /TeamAI Project Context For Gemini CLI/);
  assert.match(opencodeAgents, /TeamAI Project Context For OpenCode/);
  assert.deepEqual(opencodeConfig.instructions, [
    ".teamai/generated/adapters/opencode/AGENTS.md",
  ]);
});

test("repo reconciliation invalidates promoted path rules after repo drift", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const configPath = path.join(repo, ".teamai", "config.json");
  const config = readJson(configPath);
  config.merge.minimumGrade = "D";
  config.merge.promotion.minimumOccurrences = 1;
  config.merge.promotion.minimumEvidenceCount = 1;
  config.merge.promotion.minimumConfidence = 0;
  writeJson(configPath, config);

  completeStopSummary(repo, "sess-drift", {
    summaryPayload: {
      summary: "Stable summary.",
      knowledge: ["src/app.js is part of the project runtime surface."],
      candidate_spec: ["src/app.js should stay on the project runtime surface."],
    },
  });

  unlinkSync(path.join(repo, "src", "app.js"));

  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const sessionStartCommand = getFirstHookCommand(settings, "SessionStart");
  runJsonHook(sessionStartCommand, {
    cwd: repo,
    inputData: { cwd: repo },
  });

  const ruleStore = readJson(getRuleStorePath(repo));
  const compiledSpec = readFileSync(getCompiledSpecPath(repo), "utf8");
  const specRecord = Object.values(ruleStore.collections.spec.records).find(
    (record) => record.text === "src/app.js should stay on the project runtime surface.",
  );
  const knowledgeRecord = Object.values(ruleStore.collections.knowledge.records).find(
    (record) => record.text === "src/app.js is part of the project runtime surface.",
  );

  assert.equal(ruleStore.collections.knowledge.invalidatedCount, 1);
  assert.equal(ruleStore.collections.spec.invalidatedCount, 1);
  assert.equal(ruleStore.collections.spec.promotedCount, 0);
  assert.equal(specRecord.lifecycleStatus, "invalidated");
  assert.equal(specRecord.promotionStatus, "candidate");
  assert.match(specRecord.invalidationReason, /missing paths/);
  assert.match(specRecord.invalidatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(knowledgeRecord.lifecycleStatus, "invalidated");
  assert.equal(knowledgeRecord.promotionStatus, "candidate");
  assert.doesNotMatch(compiledSpec, /src\/app\.js should stay on the project runtime surface/);
});

test("inspect rules, compiled, and lineage expose structured observability", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const configPath = path.join(repo, ".teamai", "config.json");
  const config = readJson(configPath);
  config.merge.minimumGrade = "D";
  config.merge.promotion.minimumOccurrences = 1;
  config.merge.promotion.minimumEvidenceCount = 1;
  config.merge.promotion.minimumConfidence = 0;
  writeJson(configPath, config);

  completeStopSummary(repo, "sess-inspect", {
    summaryPayload: {
      summary: "Stable summary.",
      knowledge: ["src/app.js is part of the project runtime surface."],
      candidate_spec: ["src/app.js should stay on the project runtime surface."],
    },
  });

  const ruleStore = readJson(getRuleStorePath(repo));
  const specFingerprint = Object.entries(ruleStore.collections.spec.records).find(
    ([, record]) => record.text === "src/app.js should stay on the project runtime surface.",
  )[0];

  const rulesResult = runCli(["inspect", "rules", repo, "--json"]);
  const rulesInspection = JSON.parse(rulesResult.stdout);
  assert.equal(rulesInspection.ruleStore.recordSchemaVersion, 2);
  assert.equal(rulesInspection.ruleStore.collections.spec.promotedCount, 1);

  const compiledResult = runCli(["inspect", "compiled", repo, "--json"]);
  const compiledInspection = JSON.parse(compiledResult.stdout);
  assert.equal(compiledInspection.files.codexAgents.exists, true);
  assert.equal(compiledInspection.files.geminiContext.exists, true);
  assert.equal(compiledInspection.files.opencodeConfig.exists, true);

  const lineageResult = runCli(["inspect", "lineage", specFingerprint, repo, "--json"]);
  const lineageInspection = JSON.parse(lineageResult.stdout);
  assert.equal(lineageInspection.collection, "spec");
  assert.equal(lineageInspection.record.text, "src/app.js should stay on the project runtime surface.");
  assert.equal(lineageInspection.record.kind, "path-rule");
  assert.equal(lineageInspection.evidence.length, 1);
  assert.equal(lineageInspection.evidence[0].exists, true);
});

test("custom artifact and outbox paths stay functional when kept inside .teamai", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const add = spawnSync("git", ["add", "src/app.js"], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.equal(add.status, 0, add.stderr || add.stdout);

  const commit = spawnSync(
    "git",
    [
      "-c",
      "user.name=TeamAI",
      "-c",
      "user.email=teamai@example.com",
      "commit",
      "-m",
      "baseline",
    ],
    {
      cwd: repo,
      encoding: "utf8",
    },
  );
  assert.equal(commit.status, 0, commit.stderr || commit.stdout);

  writeFileSync(path.join(repo, "src", "app.js"), "export const app = 2;\n", "utf8");

  const configPath = path.join(repo, ".teamai", "config.json");
  const config = readJson(configPath);
  config.artifacts = {
    ...config.artifacts,
    latestEvidencePath: "artifacts/latest/evidence.json",
    memoryPath: "artifacts/memory/shared.md",
    candidateSpecPath: "artifacts/specs/candidate.md",
  };
  config.sync = {
    ...config.sync,
    enabled: true,
    outboxDir: "artifacts/outbox",
  };
  writeJson(configPath, config);

  const { latest } = completeStopSummary(repo, "sess-custom-paths");
  const latestPath = getLatestEvidencePath(repo);
  const outboxDir = getSyncOutboxDir(repo);

  assert.equal(existsSync(latestPath), true);
  assert.equal(
    existsSync(path.resolve(repo, ".teamai", "artifacts/memory/shared.md")),
    true,
  );
  assert.equal(
    existsSync(path.resolve(repo, ".teamai", "artifacts/specs/candidate.md")),
    true,
  );

  const outboxFiles = readdirSync(outboxDir).filter((name) => name !== ".gitkeep");
  assert.equal(outboxFiles.length, 1);
  assert.equal(outboxFiles[0], `${latest.eventId}.json`);

  const inspectResult = runCli(["inspect", "latest", repo, "--json"]);
  const inspected = JSON.parse(inspectResult.stdout);
  assert.equal(inspected.eventId, latest.eventId);

  const statusResult = runCli(["status", repo, "--json"]);
  const status = JSON.parse(statusResult.stdout);
  assert.equal(status.latestEvidence.eventId, latest.eventId);
  assert.equal(status.outboxEntries, 1);
});

test("path traversal in artifact config is rejected before TeamAI writes outside .teamai", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const configPath = path.join(repo, ".teamai", "config.json");
  const config = readJson(configPath);
  config.artifacts = {
    ...config.artifacts,
    latestEvidencePath: "../leak.json",
  };
  writeJson(configPath, config);

  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const stopCommand = getFirstHookCommand(settings, "Stop");
  const subagentStartCommand = getFirstHookCommand(settings, "SubagentStart");
  const subagentStopCommand = getFirstHookCommand(settings, "SubagentStop");
  const assistantMessage =
    "This is a detailed assistant response about the completed work. ".repeat(12);

  runJsonHook(stopCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      session_id: "sess-path-traversal",
      last_assistant_message: assistantMessage,
    },
  });
  const subagentStartResult = runHookCommand(subagentStartCommand, {
    cwd: repo,
    input: JSON.stringify({
      cwd: repo,
      session_id: "sess-path-traversal",
      subagent_type: SUMMARY_AGENT_NAME,
      subagent_id: "agent-1",
    }),
  });

  assert.notEqual(subagentStartResult.status, 0);
  assert.match(
    subagentStartResult.stderr,
    /artifacts\.latestEvidencePath must stay within \.teamai\//,
  );
  assert.equal(existsSync(path.join(repo, "leak.json")), false);

  const statusResult = runCli(["status", repo], { expectSuccess: false });
  assert.notEqual(statusResult.status, 0);
  assert.match(
    statusResult.stderr,
    /artifacts\.latestEvidencePath must stay within \.teamai\//,
  );
});

test("status reports the config path when TeamAI config JSON is invalid", () => {
  const repo = makeRepo();
  runCli(["init", repo]);

  const configPath = path.join(repo, ".teamai", "config.json");
  writeFileSync(configPath, "{ invalid json\n", "utf8");

  const statusResult = runCli(["status", repo], { expectSuccess: false });
  assert.notEqual(statusResult.status, 0);
  assert.match(statusResult.stderr, /Failed to parse JSON at /);
  assert.match(statusResult.stderr, new RegExp(escapeRegExp(configPath)));
});

test("inspect latest reports the evidence path when latest evidence JSON is invalid", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  completeStopSummary(repo, "sess-invalid-latest");
  const latestEvidencePath = getLatestEvidencePath(repo);
  writeFileSync(latestEvidencePath, "{ invalid latest evidence\n", "utf8");

  const inspectResult = runCli(["inspect", "latest", repo], { expectSuccess: false });
  assert.notEqual(inspectResult.status, 0);
  assert.match(inspectResult.stderr, /Failed to parse JSON at /);
  assert.match(inspectResult.stderr, new RegExp(escapeRegExp(latestEvidencePath)));
});

test("stop and subagent hooks persist JSON summaries, filter internal files, and honor sync.enabled", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const stopCommand = getFirstHookCommand(settings, "Stop");
  const subagentStartCommand = getFirstHookCommand(settings, "SubagentStart");
  const subagentStopCommand = getFirstHookCommand(settings, "SubagentStop");
  const assistantMessage =
    "This is a detailed assistant response about the completed work. ".repeat(12);

  const stopOutput = runJsonHook(stopCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      session_id: "sess-123",
      last_assistant_message: assistantMessage,
    },
  });

  const startOutput = runJsonHook(subagentStartCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      session_id: "sess-123",
      subagent_type: SUMMARY_AGENT_NAME,
      subagent_id: "agent-1",
    },
  });

  writeFileSync(path.join(repo, "src", "later.js"), "export const later = 1;\n", "utf8");

  const stopSubagentOutput = runJsonHook(subagentStopCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      session_id: "sess-123",
      subagent_type: SUMMARY_AGENT_NAME,
      subagent_id: "agent-1",
      last_assistant_message: JSON.stringify({
        summary: "Stable summary.",
        knowledge: ["src/app.js is part of the project runtime surface"],
        candidate_spec: ["Keep TeamAI summaries JSON-only and subagent-driven"],
      }),
    },
  });

  const latest = readJson(path.join(repo, ".teamai", "evidence", "latest.json"));
  const summaryState = readJson(path.join(repo, ".teamai", "state", "summary-state.json"));

  assert.equal(stopOutput.decision, "block");
  assert.match(stopOutput.reason, /teamai-memory-summarizer/);
  assert.match(
    startOutput.hookSpecificOutput.additionalContext,
    /summary_request_id:/,
  );
  assert.match(
    startOutput.hookSpecificOutput.additionalContext,
    /src\/app\.js/,
  );
  assert.deepEqual(stopSubagentOutput, { continue: true, suppressOutput: true });

  assert.equal(latest.summary, "Stable summary.");
  assert.deepEqual(latest.knowledge, [
    "src/app.js is part of the project runtime surface",
  ]);
  assert.deepEqual(latest.candidateSpec, [
    "Keep TeamAI summaries JSON-only and subagent-driven",
  ]);
  assert.equal(latest.generator, SUMMARY_AGENT_NAME);
  assert.ok(latest.files.includes("src/app.js"));
  assert.ok(!latest.files.includes("src/later.js"));
  assert.ok(!latest.files.some((file) => file.startsWith(".omc/")));
  assert.ok(!latest.files.some((file) => file.startsWith(".claude/")));
  assert.ok(!latest.files.some((file) => file.startsWith(".teamai/")));
  assert.equal(latest.source.worktreeSnapshotUsed, true);
  assert.match(latest.source.worktreeSnapshotCapturedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(latest.source.diffChars > 0);

  const requests = Object.values(summaryState.requests);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, "completed");
  assert.equal(requests[0].agentId, "agent-1");
  assert.equal(requests[0].evidenceEventId, latest.eventId);

  const outboxFiles = readdirSync(path.join(repo, ".teamai", "sync", "outbox")).filter(
    (name) => name !== ".gitkeep",
  );
  assert.deepEqual(outboxFiles, []);
});

test("session_end completes pending stop summaries with deferred extraction", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const stopCommand = getFirstHookCommand(settings, "Stop");
  const assistantMessage = [
    "Keep TeamAI summaries JSON-only and subagent-driven.",
    "src/app.js is part of the project runtime surface.",
  ].join(" ");

  const stopOutput = runJsonHook(stopCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      session_id: "sess-deferred",
      last_assistant_message: assistantMessage,
    },
  });
  assert.equal(stopOutput.decision, "block");

  const statePath = path.join(repo, ".teamai", "state", "summary-state.json");
  const stateBefore = readJson(statePath);
  const request = Object.values(stateBefore.requests)[0];
  assert.equal(request.status, "pending");

  const eventPath = path.join(
    repo,
    ".teamai",
    "state",
    "session-events",
    "manual-deferred-event.json",
  );
  writeJson(eventPath, {
    eventId: "manual-deferred-event",
    eventKind: "session_end_fallback",
    createdAt: "2026-03-26T08:00:00Z",
    sessionId: "sess-deferred",
    reason: "other",
    transcriptPath: "",
    repoRoot: repo,
  });

  const worker = spawnSync(
    "python3",
    [path.join(repo, ".teamai", "hooks", "session_end.py"), "--worker", "--event-file", eventPath],
    {
      cwd: repo,
      encoding: "utf8",
    },
  );
  assert.equal(worker.status, 0, worker.stderr || worker.stdout);

  const latest = readJson(path.join(repo, ".teamai", "evidence", "latest.json"));
  assert.equal(latest.generator, "session-end-deferred");
  assert.equal(latest.source.sessionEndDeferred, true);
  assert.equal(latest.source.summaryRequestId, request.requestId);
  assert.equal(latest.source.sessionEndEventId, "manual-deferred-event");
  assert.match(latest.summary, /Deferred TeamAI summary captured after session end/);
  assert.deepEqual(latest.knowledge, ["src/app.js is part of the project runtime surface."]);
  assert.deepEqual(latest.candidateSpec, [
    "Keep TeamAI summaries JSON-only and subagent-driven.",
  ]);

  const nextState = readJson(statePath);
  const nextRequest = nextState.requests[request.requestId];
  assert.equal(nextRequest.status, "completed");
  assert.equal(nextRequest.completionMode, "session-end-deferred");
  assert.equal(nextRequest.evidenceEventId, latest.eventId);
  assert.equal(existsSync(eventPath), false);
});

test("session_end writes fallback evidence when no completed stop summary exists", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const eventPath = path.join(
    repo,
    ".teamai",
    "state",
    "session-events",
    "manual-event.json",
  );
  writeJson(eventPath, {
    eventId: "manual-event",
    eventKind: "session_end_fallback",
    createdAt: "2026-03-26T08:00:00Z",
    sessionId: "sess-fallback",
    reason: "other",
    transcriptPath: "",
    repoRoot: repo,
    worktreeFiles: ["src/app.js"],
    worktreeDiff: "$ git diff --stat --unified=0 --no-ext-diff -- .\n src/app.js | 1 +",
    worktreeCapturedAt: "2026-03-26T08:00:00Z",
  });

  writeFileSync(path.join(repo, "src", "later.js"), "export const later = 1;\n", "utf8");

  const worker = spawnSync(
    "python3",
    [path.join(repo, ".teamai", "hooks", "session_end.py"), "--worker", "--event-file", eventPath],
    {
      cwd: repo,
      encoding: "utf8",
    },
  );
  assert.equal(worker.status, 0, worker.stderr || worker.stdout);

  const latest = readJson(path.join(repo, ".teamai", "evidence", "latest.json"));
  assert.equal(latest.generator, "session-end-fallback");
  assert.equal(latest.source.sessionEndFallback, true);
  assert.equal(latest.source.worktreeSnapshotUsed, true);
  assert.equal(latest.source.worktreeSnapshotCapturedAt, "2026-03-26T08:00:00Z");
  assert.match(latest.summary, /completed TeamAI subagent summary/);
  assert.deepEqual(latest.files, ["src/app.js"]);
  assert.ok(!latest.files.some((file) => file.startsWith(".omc/")));
  assert.ok(!latest.files.some((file) => file.startsWith(".claude/")));
  assert.ok(!latest.files.some((file) => file.startsWith(".teamai/")));
  assert.equal(existsSync(eventPath), false);
});

test("session_end skips fallback if the session already has a completed stop summary", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const { latest, summaryState } = completeStopSummary(repo, "sess-complete");
  summaryState.requests["stale-request"] = {
    requestId: "stale-request",
    sessionId: "sess-complete",
    status: "failed",
    createdAt: "2026-03-26T08:00:01Z",
    updatedAt: "2026-03-26T08:00:02Z",
  };
  writeJson(path.join(repo, ".teamai", "state", "summary-state.json"), summaryState);

  const eventPath = path.join(
    repo,
    ".teamai",
    "state",
    "session-events",
    "manual-complete-event.json",
  );
  writeJson(eventPath, {
    eventId: "manual-complete-event",
    eventKind: "session_end_fallback",
    createdAt: "2026-03-26T08:01:00Z",
    sessionId: "sess-complete",
    reason: "other",
    transcriptPath: "",
    repoRoot: repo,
  });

  const worker = spawnSync(
    "python3",
    [path.join(repo, ".teamai", "hooks", "session_end.py"), "--worker", "--event-file", eventPath],
    {
      cwd: repo,
      encoding: "utf8",
    },
  );
  assert.equal(worker.status, 0, worker.stderr || worker.stdout);

  const latestAfterFallback = readJson(path.join(repo, ".teamai", "evidence", "latest.json"));
  assert.equal(latestAfterFallback.eventId, latest.eventId);
  assert.equal(latestAfterFallback.generator, SUMMARY_AGENT_NAME);

  const nextState = readJson(path.join(repo, ".teamai", "state", "summary-state.json"));
  assert.equal(nextState.requests["stale-request"].status, "expired");
  assert.equal(
    nextState.requests["stale-request"].fallbackEventId,
    "manual-complete-event",
  );
  assert.equal(existsSync(eventPath), false);
});
