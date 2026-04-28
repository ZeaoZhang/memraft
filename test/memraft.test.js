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
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..");
const CLI_PATH = path.join(PROJECT_ROOT, "bin", "memraft.js");
const SUMMARY_AGENT_NAME = "memraft-memory-summarizer";

function makeRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "memraft-test-"));
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
    if (existsSync(path.join(current, ".git")) || existsSync(path.join(current, ".memraft"))) {
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

function readMemraftConfig(repo) {
  return readJson(path.join(repo, ".memraft", "config.json"));
}

function updateMemraftConfig(repo, mutator) {
  const configPath = path.join(repo, ".memraft", "config.json");
  const config = readMemraftConfig(repo);
  mutator(config);
  writeJson(configPath, config);
}

function setStopSummaryMode(repo, mode, overrides = {}) {
  updateMemraftConfig(repo, (config) => {
    config.stopSummary = {
      ...(config.stopSummary ?? {}),
      mode,
      ...overrides,
    };
  });
}

function getConfiguredMemraftPath(repo, relativePath, fallback) {
  const nextRelativePath =
    typeof relativePath === "string" && relativePath ? relativePath : fallback;
  return path.resolve(repo, ".memraft", nextRelativePath);
}

function getLatestEvidencePath(repo) {
  const config = readMemraftConfig(repo);
  return getConfiguredMemraftPath(
    repo,
    config.artifacts?.latestEvidencePath,
    "evidence/latest.json",
  );
}

function getSyncOutboxDir(repo) {
  const config = readMemraftConfig(repo);
  return getConfiguredMemraftPath(
    repo,
    config.sync?.outboxDir,
    "sync/outbox",
  );
}

function getRepoProfilePath(repo) {
  const config = readMemraftConfig(repo);
  return getConfiguredMemraftPath(
    repo,
    config.artifacts?.repoProfilePath,
    "state/repo-profile.json",
  );
}

function getRuleStorePath(repo) {
  const config = readMemraftConfig(repo);
  return getConfiguredMemraftPath(
    repo,
    config.artifacts?.ruleStorePath,
    "state/rule-store.json",
  );
}

function getCompiledSpecPath(repo) {
  const config = readMemraftConfig(repo);
  return getConfiguredMemraftPath(
    repo,
    config.artifacts?.compiledSpecPath,
    "generated/spec.md",
  );
}

function getCompiledStatePath(repo) {
  return path.join(repo, ".memraft", "state", "compiled-state.json");
}

function getRuntimeSummaryPath(repo) {
  return path.join(repo, ".memraft", "state", "runtime-summary.json");
}

function getSqlitePath(repo) {
  return path.join(repo, ".memraft", "state", "index.sqlite");
}

function getAdapterManifestPath(repo) {
  return path.join(repo, ".memraft", "generated", "adapters", "manifest.json");
}

function getCodexAgentsPath(repo) {
  return path.join(repo, ".memraft", "generated", "adapters", "codex", "AGENTS.md");
}

function getCodexConfigPath(repo) {
  return path.join(repo, ".memraft", "generated", "adapters", "codex", "config.toml");
}

function getCodexHooksPath(repo) {
  return path.join(repo, ".memraft", "generated", "adapters", "codex", "hooks.json");
}

function getGeminiContextPath(repo) {
  return path.join(repo, ".memraft", "generated", "adapters", "gemini", "GEMINI.md");
}

function getOpenCodeAgentsPath(repo) {
  return path.join(repo, ".memraft", "generated", "adapters", "opencode", "AGENTS.md");
}

function getOpenCodeConfigPath(repo) {
  return path.join(repo, ".memraft", "generated", "adapters", "opencode", "opencode.json");
}

function getOpenCodePluginPath(repo) {
  return path.join(repo, ".memraft", "generated", "adapters", "opencode", "memraft-auto-capture.js");
}

function getSharedRegistryPath(repo) {
  return path.join(repo, "memraft", "registry.json");
}

function getSharedBackgroundPath(repo) {
  return path.join(repo, "memraft", "spec", "background.md");
}

function getSharedConventionsPath(repo) {
  return path.join(repo, "memraft", "spec", "conventions.md");
}

function getSharedWorkflowsPath(repo) {
  return path.join(repo, "memraft", "spec", "workflows.md");
}

function getNativeAgentsPath(repo) {
  return path.join(repo, "AGENTS.md");
}

function getNativeCodexConfigPath(repo) {
  return path.join(repo, ".codex", "config.toml");
}

function getNativeCodexHooksPath(repo) {
  return path.join(repo, ".codex", "hooks.json");
}

function getNativeGeminiPath(repo) {
  return path.join(repo, "GEMINI.md");
}

function getNativeOpenCodeConfigPath(repo) {
  return path.join(repo, "opencode.json");
}

function getNativeOpenCodePluginPath(repo) {
  return path.join(repo, ".opencode", "plugins", "memraft-auto-capture.js");
}

function getSessionInjectionPath(repo) {
  const config = readMemraftConfig(repo);
  return getConfiguredMemraftPath(
    repo,
    config.artifacts?.sessionStartInjectionPath,
    "generated/inject/session-start.txt",
  );
}

function getToolInjectionPath(repo) {
  const config = readMemraftConfig(repo);
  return getConfiguredMemraftPath(
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
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: projectDir,
        GEMINI_PROJECT_DIR: projectDir,
      },
    });
  }

  return spawnSync("sh", ["-lc", command], {
    cwd,
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      GEMINI_PROJECT_DIR: projectDir,
    },
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
  writeFileSync(path.join(repo, ".omc", "memraft.json"), "{}\n", "utf8");
}

function completeStopSummary(repo, sessionId, options = {}) {
  setStopSummaryMode(repo, "full", {
    minimumConversationChars: 1,
  });
  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const stopCommand = getFirstHookCommand(settings, "Stop");
  const subagentStartCommand = getFirstHookCommand(settings, "SubagentStart");
  const subagentStopCommand = getFirstHookCommand(settings, "SubagentStop");
  const assistantMessage =
    "This is a detailed assistant response about the completed work. ".repeat(12);
  const summaryPayload = options.summaryPayload ?? {
    summary: "Stable summary.",
    knowledge: ["src/app.js is part of the project runtime surface"],
    candidate_spec: ["Keep Memraft summaries JSON-only and subagent-driven"],
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
    summaryState: readJson(path.join(repo, ".memraft", "state", "summary-state.json")),
  };
}

function runManualCapture(repo, { tool, sessionId = "", payload }) {
  const result = spawnSync(
    "node",
    [
      path.join(repo, ".memraft", "hooks", "manual_capture.mjs"),
      "--tool",
      tool,
      ...(sessionId ? ["--session-id", sessionId] : []),
    ],
    {
      cwd: repo,
      encoding: "utf8",
      input: JSON.stringify(payload),
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runAutomaticCapture(repo, { tool, eventType = "", payload = {} }) {
  const result = spawnSync(
    "node",
    [
      path.join(repo, ".memraft", "hooks", "auto_capture.mjs"),
      "--tool",
      tool,
      ...(eventType ? ["--event-type", eventType] : []),
      JSON.stringify(payload),
    ],
    {
      cwd: repo,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runCodexNotify(repo, payload) {
  const result = spawnSync(
    "node",
    [
      path.join(repo, ".memraft", "hooks", "codex_notify.mjs"),
      JSON.stringify(payload),
    ],
    {
      cwd: repo,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function readCodexHooks(repo, { native = true } = {}) {
  return readJson(native ? getNativeCodexHooksPath(repo) : getCodexHooksPath(repo));
}

function getFirstCodexHookCommand(repo, eventName, { native = true } = {}) {
  const hooks = readCodexHooks(repo, { native });
  const entries = hooks?.hooks?.[eventName];
  assert.ok(Array.isArray(entries) && entries.length > 0, `missing ${eventName} codex hook`);
  const commands = entries[0]?.hooks;
  assert.ok(Array.isArray(commands) && commands.length > 0, `missing ${eventName} codex hook command`);
  return commands[0].command;
}

test("init writes stable hook settings, installs the summary subagent, and hook commands work from subdirectories", () => {
  const repo = makeRepo();
  runCli(["init", repo]);

  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const geminiSettings = readJson(path.join(repo, ".gemini", "settings.json"));
  const sessionStartMatchers = settings.hooks.SessionStart.map((entry) => entry.matcher);
  const sessionEndMatchers = settings.hooks.SessionEnd.map((entry) => entry.matcher);
  const subagentStartMatchers = settings.hooks.SubagentStart.map((entry) => entry.matcher);
  const subagentStopMatchers = settings.hooks.SubagentStop.map((entry) => entry.matcher);
  const geminiSessionStartMatchers = geminiSettings.hooks.SessionStart.map((entry) => entry.matcher);
  const geminiSessionEndMatchers = geminiSettings.hooks.SessionEnd.map((entry) => entry.matcher);

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
  assert.deepEqual(
    geminiSessionStartMatchers,
    ["startup", "resume", "clear"],
  );
  assert.deepEqual(
    geminiSessionEndMatchers,
    ["exit", "clear", "logout", "prompt_input_exit", "other"],
  );
  assert.equal(geminiSettings.hooks.BeforeAgent.length, 1);
  assert.ok(!Object.hasOwn(geminiSettings.hooks.BeforeAgent[0], "matcher"));
  assert.equal(settings.hooks.Stop.length, 1);
  assert.ok(!Object.hasOwn(settings.hooks.Stop[0], "matcher"));
  assert.equal(getFirstHook(settings, "Stop").timeout, 10);
  assert.equal(getFirstHook(settings, "SessionEnd").timeout, 10);
  assert.equal(getFirstHook(geminiSettings, "BeforeAgent").timeout, 10);

  if (process.platform === "win32") {
    assert.equal(getFirstHook(settings, "Stop").shell, "powershell");
  } else {
    assert.ok(!Object.hasOwn(getFirstHook(settings, "Stop"), "shell"));
  }

  const sessionStartCommand = getFirstHookCommand(settings, "SessionStart");
  const geminiSessionStartCommand = getFirstHookCommand(geminiSettings, "SessionStart");
  const geminiBeforeAgentCommand = getFirstHookCommand(geminiSettings, "BeforeAgent");
  assert.match(sessionStartCommand, /CLAUDE_PROJECT_DIR/);
  assert.match(sessionStartCommand, /session_start/);
  assert.doesNotMatch(sessionStartCommand, new RegExp(escapeRegExp(repo)));
  assert.match(geminiSessionStartCommand, /GEMINI_PROJECT_DIR/);
  assert.match(geminiSessionStartCommand, /session_start/);
  assert.match(geminiBeforeAgentCommand, /GEMINI_PROJECT_DIR/);
  assert.match(geminiBeforeAgentCommand, /gemini_before_agent/);
  assert.doesNotMatch(geminiSessionStartCommand, new RegExp(escapeRegExp(repo)));

  assert.ok(
    existsSync(path.join(repo, ".claude", "agents", "memraft-memory-summarizer.md")),
  );

  const subdir = path.join(repo, "nested", "workspace");
  mkdirSync(subdir, { recursive: true });
  const hookOutput = runJsonHook(sessionStartCommand, {
    cwd: subdir,
    inputData: { cwd: subdir },
  });
  assert.equal(hookOutput.hookSpecificOutput.hookEventName, "SessionStart");

  const geminiHookOutput = runJsonHook(geminiSessionStartCommand, {
    cwd: subdir,
    inputData: { cwd: subdir, source: "startup" },
  });
  assert.equal(geminiHookOutput.hookSpecificOutput.hookEventName, "SessionStart");

  const geminiBeforeAgentOutput = runJsonHook(geminiBeforeAgentCommand, {
    cwd: subdir,
    inputData: { cwd: subdir, prompt: "Check the repo" },
  });
  assert.equal(geminiBeforeAgentOutput.hookSpecificOutput.hookEventName, "BeforeAgent");
  assert.match(
    geminiBeforeAgentOutput.hookSpecificOutput.additionalContext,
    /Repository background:/,
  );

  const statusResult = runCli(["status", repo, "--json"]);
  const status = JSON.parse(statusResult.stdout);
  assert.deepEqual(status.hooks, {
    sessionStart: true,
    preToolUse: true,
    stop: true,
    subagentStart: true,
    subagentStop: true,
    sessionEnd: true,
  });
});

test("init bootstraps native instruction entrypoints and preserves existing project files", () => {
  const repo = makeRepo();
  writeFileSync(getNativeAgentsPath(repo), "# Manual Instructions\n\nPreserve this line.\n", "utf8");
  writeFileSync(getNativeGeminiPath(repo), "# Gemini Notes\n\nKeep this note.\n", "utf8");
  writeFileSync(
    getNativeOpenCodeConfigPath(repo),
    `${JSON.stringify({ model: "openai/gpt-5", instructions: ["docs/local.md"] }, null, 2)}\n`,
    "utf8",
  );

  runCli(["init", repo]);

  const nativeAgents = readFileSync(getNativeAgentsPath(repo), "utf8");
  const nativeGemini = readFileSync(getNativeGeminiPath(repo), "utf8");
  const nativeOpenCodeConfig = readJson(getNativeOpenCodeConfigPath(repo));
  const nativeCodexConfig = readFileSync(getNativeCodexConfigPath(repo), "utf8");
  const nativeCodexHooks = readCodexHooks(repo);
  const nativeOpenCodePlugin = readFileSync(getNativeOpenCodePluginPath(repo), "utf8");
  const sharedRegistry = readJson(getSharedRegistryPath(repo));

  assert.match(nativeAgents, /Preserve this line\./);
  assert.match(nativeAgents, /<!-- MEMRAFT:BEGIN project-context -->/);
  assert.match(nativeAgents, /# Memraft Context/);
  assert.match(nativeGemini, /Keep this note\./);
  assert.match(nativeGemini, /<!-- MEMRAFT:BEGIN project-context -->/);
  assert.match(nativeGemini, /Memraft Context For Gemini CLI/);
  assert.match(nativeCodexConfig, /MEMRAFT:BEGIN codex-hooks/);
  assert.match(nativeCodexConfig, /features\.codex_hooks = true/);
  assert.deepEqual(
    Object.keys(nativeCodexHooks.hooks ?? {}).sort(),
    ["SessionStart", "Stop", "UserPromptSubmit"],
  );
  assert.equal(nativeOpenCodeConfig.model, "openai/gpt-5");
  assert.deepEqual(nativeOpenCodeConfig.instructions, [
    "docs/local.md",
    "AGENTS.md",
    ".memraft/generated/inject/tool-task.txt",
  ]);
  assert.deepEqual(nativeOpenCodeConfig.plugins, [
    ".opencode/plugins/memraft-auto-capture.js",
  ]);
  assert.match(nativeOpenCodePlugin, /session\.idle/);
  assert.match(nativeOpenCodePlugin, /MemraftAutoCapturePlugin/);
  assert.equal(sharedRegistry.version, 1);
  assert.ok(existsSync(getSharedBackgroundPath(repo)));
  assert.ok(existsSync(getSharedConventionsPath(repo)));
  assert.ok(existsSync(getSharedWorkflowsPath(repo)));

  runCli(["init", repo, "--skip-existing"]);
  const rerunOpenCodeConfig = readJson(getNativeOpenCodeConfigPath(repo));
  assert.deepEqual(rerunOpenCodeConfig.instructions, [
    "docs/local.md",
    "AGENTS.md",
    ".memraft/generated/inject/tool-task.txt",
  ]);
  assert.deepEqual(rerunOpenCodeConfig.plugins, [
    ".opencode/plugins/memraft-auto-capture.js",
  ]);
});

test("existing codex notify config no longer blocks managed hooks mode", () => {
  const repo = makeRepo();
  mkdirSync(path.dirname(getNativeCodexConfigPath(repo)), { recursive: true });
  writeFileSync(
    getNativeCodexConfigPath(repo),
    'notify = ["node", "-e", "console.log(\\"custom\\")"]\n',
    "utf8",
  );

  runCli(["init", repo]);
  seedWorktree(repo);

  const status = JSON.parse(runCli(["status", repo, "--json"]).stdout);
  const nativeCodexConfig = readFileSync(getNativeCodexConfigPath(repo), "utf8");
  assert.equal(status.runtime.adapterStates.nativeCodexConfig.ownership, "managed");
  assert.equal(status.runtime.adapterStates.nativeCodexHooks.ownership, "managed");
  assert.equal(status.runtime.adapterModes.codex.mode, "full");
  assert.match(nativeCodexConfig, /^notify = \[/m);
  assert.match(nativeCodexConfig, /features\.codex_hooks = true/);
});

test("invalid codex hooks json switches codex into inject-only mode and skips automatic capture", () => {
  const repo = makeRepo();
  mkdirSync(path.dirname(getNativeCodexHooksPath(repo)), { recursive: true });
  writeFileSync(getNativeCodexHooksPath(repo), "{ invalid hooks json\n", "utf8");

  runCli(["init", repo]);
  seedWorktree(repo);

  const status = JSON.parse(runCli(["status", repo, "--json"]).stdout);
  const toolInjection = readFileSync(getToolInjectionPath(repo), "utf8");
  const codexAgents = readFileSync(getCodexAgentsPath(repo), "utf8");
  const nativeAgents = readFileSync(getNativeAgentsPath(repo), "utf8");
  assert.equal(status.runtime.adapterStates.nativeCodexHooks.ownership, "conflict");
  assert.equal(status.runtime.adapterModes.codex.mode, "inject-only");
  assert.match(toolInjection, /Codex adapter mode: inject-only/);
  assert.match(toolInjection, /Automatic Codex capture is unavailable/);
  assert.match(codexAgents, /Codex adapter mode: inject-only/);
  assert.match(nativeAgents, /Codex adapter mode: inject-only/);

  const result = runCodexNotify(repo, {
    type: "agent-turn-complete",
    id: "codex-conflict-1",
    message: "src/app.js should stay on the project runtime surface.",
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "capture_disabled");
});

test("init --skip-existing upgrades existing Memraft hook commands and timeouts", () => {
  const repo = makeRepo();
  runCli(["init", repo]);

  const settingsPath = path.join(repo, ".claude", "settings.json");
  const settings = readJson(settingsPath);
  settings.hooks.SessionStart[0].hooks[0] = {
    type: "command",
    command: `node ${JSON.stringify(path.join(repo, ".memraft", "hooks", "session_start.mjs"))}`,
    timeout: 99,
  };
  settings.hooks.SessionEnd[0].hooks[0] = {
    type: "command",
    command: `node ${JSON.stringify(path.join(repo, ".memraft", "hooks", "session_end.mjs"))}`,
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

test("init requires an explicit overwrite strategy once Memraft files already exist", () => {
  const repo = makeRepo();
  runCli(["init", repo]);

  const memoryPath = path.join(repo, ".memraft", "knowledge", "memory.md");
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
  const runtimeSummary = readJson(getRuntimeSummaryPath(repo));

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
  assert.equal(existsSync(getSqlitePath(repo)), true);
  assert.equal(runtimeSummary.pendingPromotionCount, 0);
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
  assert.equal(status.generated.runtimeSummary, true);
  assert.equal(status.generated.sqlite, true);
  assert.equal(status.runtime.adapterStates.nativeAgents.ownership, "managed");
  assert.equal(status.runtime.adapterStates.nativeCodexConfig.ownership, "managed");
  assert.equal(status.runtime.adapterStates.nativeCodexHooks.ownership, "managed");
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

  const configPath = path.join(repo, ".memraft", "config.json");
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
    /Keep Memraft summaries JSON-only and subagent-driven/,
  );
  assert.match(
    compiledSpec,
    /src\/app\.js is part of the project runtime surface/,
  );
  assert.match(toolInjection, /Stable project rules:/);
  assert.match(
    toolInjection,
    /Keep Memraft summaries JSON-only and subagent-driven/,
  );
  assert.match(toolInjection, /Recent evidence:/);
  assert.equal(latest.merge.eligible, true);
});

test("rule store exports typed metadata for promoted records", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const configPath = path.join(repo, ".memraft", "config.json");
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

  const configPath = path.join(repo, ".memraft", "config.json");
  const config = readJson(configPath);
  config.merge.minimumGrade = "D";
  config.merge.promotion.minimumOccurrences = 1;
  config.merge.promotion.minimumEvidenceCount = 1;
  config.merge.promotion.minimumConfidence = 0;
  writeJson(configPath, config);

  completeStopSummary(repo, "sess-adapters");

  const manifest = readJson(getAdapterManifestPath(repo));
  const codexAgents = readFileSync(getCodexAgentsPath(repo), "utf8");
  const codexConfig = readFileSync(getCodexConfigPath(repo), "utf8");
  const codexHooks = readCodexHooks(repo, { native: false });
  const geminiContext = readFileSync(getGeminiContextPath(repo), "utf8");
  const opencodeAgents = readFileSync(getOpenCodeAgentsPath(repo), "utf8");
  const opencodeConfig = readJson(getOpenCodeConfigPath(repo));
  const opencodePlugin = readFileSync(getOpenCodePluginPath(repo), "utf8");

  assert.equal(manifest.adapters.codex.recommendedProjectFile, "AGENTS.md");
  assert.match(manifest.adapters.codex.configSnippetPath, /generated\/adapters\/codex\/config\.toml$/);
  assert.match(manifest.adapters.codex.hooksPath, /generated\/adapters\/codex\/hooks\.json$/);
  assert.equal(manifest.adapters.gemini.recommendedProjectFile, "GEMINI.md");
  assert.equal(manifest.adapters.opencode.recommendedProjectFile, "AGENTS.md");
  assert.match(manifest.adapters.opencode.pluginPath, /generated\/adapters\/opencode\/memraft-auto-capture\.js$/);
  assert.match(codexAgents, /Memraft Context For Codex/);
  assert.match(codexAgents, /Keep Memraft summaries JSON-only and subagent-driven/);
  assert.match(codexAgents, /Session Capture Protocol/);
  assert.match(codexAgents, /manual_capture\.mjs/);
  assert.match(codexConfig, /MEMRAFT:BEGIN codex-hooks/);
  assert.match(codexConfig, /features\.codex_hooks = true/);
  assert.deepEqual(
    Object.keys(codexHooks.hooks ?? {}).sort(),
    ["SessionStart", "Stop", "UserPromptSubmit"],
  );
  assert.match(JSON.stringify(codexHooks), /codex_stop/);
  assert.match(JSON.stringify(codexHooks), /codex_user_prompt_submit/);
  assert.match(geminiContext, /Memraft Context For Gemini CLI/);
  assert.match(opencodeAgents, /Memraft Context For OpenCode/);
  assert.deepEqual(opencodeConfig.instructions, [
    "AGENTS.md",
    ".memraft/generated/inject/tool-task.txt",
  ]);
  assert.deepEqual(opencodeConfig.plugins, [
    ".opencode/plugins/memraft-auto-capture.js",
  ]);
  assert.match(opencodePlugin, /session\.idle/);
  assert.match(opencodePlugin, /MemraftAutoCapturePlugin/);
});

test("codex hooks inject context on session start and prompt submit, then capture on stop", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const sessionStartCommand = getFirstCodexHookCommand(repo, "SessionStart");
  const userPromptSubmitCommand = getFirstCodexHookCommand(repo, "UserPromptSubmit");
  const stopCommand = getFirstCodexHookCommand(repo, "Stop");

  const sessionStartOutput = runJsonHook(sessionStartCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      source: "startup",
    },
  });
  const promptOutput = runJsonHook(userPromptSubmitCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      prompt: "check the current memraft runtime",
    },
  });
  const stopOutput = runJsonHook(stopCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      session_id: "sess-codex-hooks",
      type: "agent-turn-complete",
      message: "src/app.js should stay on the project runtime surface.",
    },
  });
  const latest = readJson(getLatestEvidencePath(repo));

  assert.equal(sessionStartOutput.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(sessionStartOutput.hookSpecificOutput.additionalContext, /<memraft-context>/);
  assert.equal(promptOutput.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(promptOutput.hookSpecificOutput.additionalContext, /Adapter runtime:/);
  assert.equal(stopOutput.continue, true);
  assert.equal(stopOutput.suppressOutput, true);
  assert.equal(latest.generator, "codex-auto");
  assert.equal(latest.source.captureTool, "codex");
  assert.equal(latest.source.captureEventType, "Stop");
});

test("codex notify capture persists automatic evidence and skips duplicate snapshots", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const first = runCodexNotify(repo, {
    type: "agent-turn-complete",
    id: "codex-session-1",
    message: "src/app.js should stay on the project runtime surface.",
  });
  const latest = readJson(getLatestEvidencePath(repo));
  assert.equal(first.ok, true);
  assert.equal(first.generator, "codex-auto");
  assert.equal(latest.generator, "codex-auto");
  assert.equal(latest.source.automaticCapture, true);
  assert.equal(latest.source.captureTool, "codex");
  assert.equal(latest.source.captureEventType, "agent-turn-complete");
  assert.match(latest.summary, /src\/app\.js should stay on the project runtime surface/);

  const second = runCodexNotify(repo, {
    type: "agent-turn-complete",
    id: "codex-session-1",
    message: "src/app.js should stay on the project runtime surface.",
  });
  if (second.skipped === true) {
    assert.equal(second.reason, "duplicate");
  } else {
    assert.equal(second.eventId, first.eventId);
  }
});

test("opencode automatic capture persists evidence from plugin-compatible events", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const result = runAutomaticCapture(repo, {
    tool: "opencode",
    eventType: "session.idle",
    payload: {
      event: {
        type: "session.idle",
        sessionId: "open-session-1",
        summary: "src/app.js is part of the project runtime surface.",
      },
    },
  });

  const latest = readJson(getLatestEvidencePath(repo));
  assert.equal(result.ok, true);
  assert.equal(result.generator, "opencode-auto");
  assert.equal(latest.generator, "opencode-auto");
  assert.equal(latest.source.automaticCapture, true);
  assert.equal(latest.source.captureTool, "opencode");
  assert.equal(latest.source.captureEventType, "session.idle");
});

test("manual capture script lets codex write back into the shared local Memraft runtime", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const configPath = path.join(repo, ".memraft", "config.json");
  const config = readJson(configPath);
  config.merge.promotion.minimumOccurrences = 1;
  config.merge.promotion.minimumEvidenceCount = 1;
  config.merge.promotion.minimumConfidence = 0;
  writeJson(configPath, config);

  const captureResult = runManualCapture(repo, {
    tool: "codex",
    sessionId: "sess-codex-manual",
    payload: {
      summary: "Codex updated the runtime surface and captured the rule locally.",
      knowledge: ["src/app.js is part of the project runtime surface."],
      candidate_spec: ["src/app.js should stay on the project runtime surface."],
    },
  });

  const latest = readJson(getLatestEvidencePath(repo));
  const ruleStore = readJson(getRuleStorePath(repo));
  const compiledSpec = readFileSync(getCompiledSpecPath(repo), "utf8");
  const nativeAgents = readFileSync(getNativeAgentsPath(repo), "utf8");

  assert.equal(captureResult.ok, true);
  assert.equal(latest.generator, "codex-manual");
  assert.equal(latest.source.manualCapture, true);
  assert.equal(latest.source.captureTool, "codex");
  assert.equal(latest.merge.eligible, true);
  assert.equal(ruleStore.collections.knowledge.promotedCount, 1);
  assert.equal(ruleStore.collections.spec.promotedCount, 1);
  assert.match(compiledSpec, /src\/app\.js should stay on the project runtime surface/);
  assert.match(nativeAgents, /manual_capture\.mjs/);
});

test("managed native entrypoints refresh automatically when promoted rules change", () => {
  const repo = makeRepo();
  writeFileSync(getNativeAgentsPath(repo), "# Repo Guidance\n\nManual preface stays.\n", "utf8");
  runCli(["init", repo]);
  seedWorktree(repo);

  const configPath = path.join(repo, ".memraft", "config.json");
  const config = readJson(configPath);
  config.merge.minimumGrade = "D";
  config.merge.promotion.minimumOccurrences = 1;
  config.merge.promotion.minimumEvidenceCount = 1;
  config.merge.promotion.minimumConfidence = 0;
  writeJson(configPath, config);

  const beforeAgents = readFileSync(getNativeAgentsPath(repo), "utf8");
  assert.doesNotMatch(beforeAgents, /Keep Memraft summaries JSON-only and subagent-driven/);

  completeStopSummary(repo, "sess-native-sync");

  const nativeAgents = readFileSync(getNativeAgentsPath(repo), "utf8");
  const nativeGemini = readFileSync(getNativeGeminiPath(repo), "utf8");
  const nativeOpenCodeConfig = readJson(getNativeOpenCodeConfigPath(repo));

  assert.match(nativeAgents, /Manual preface stays\./);
  assert.match(nativeAgents, /Keep Memraft summaries JSON-only and subagent-driven/);
  assert.match(nativeGemini, /Keep Memraft summaries JSON-only and subagent-driven/);
  assert.deepEqual(nativeOpenCodeConfig.instructions, [
    "AGENTS.md",
    ".memraft/generated/inject/tool-task.txt",
  ]);
});

test("repo reconciliation invalidates promoted path rules after repo drift", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const configPath = path.join(repo, ".memraft", "config.json");
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

  const configPath = path.join(repo, ".memraft", "config.json");
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
  assert.equal(compiledInspection.files.codexConfig.exists, true);
  assert.equal(compiledInspection.files.codexHooks.exists, true);
  assert.equal(compiledInspection.files.geminiContext.exists, true);
  assert.equal(compiledInspection.files.opencodeConfig.exists, true);
  assert.equal(compiledInspection.files.nativeAgents.exists, true);
  assert.equal(compiledInspection.files.nativeCodexConfig.exists, true);
  assert.equal(compiledInspection.files.nativeCodexHooks.exists, true);
  assert.equal(compiledInspection.files.nativeGemini.exists, true);
  assert.equal(compiledInspection.files.nativeOpencodeConfig.exists, true);
  assert.equal(compiledInspection.runtimeSummary.adapterStates.nativeAgents.ownership, "managed");
  assert.equal(compiledInspection.runtimeSummary.adapterStates.nativeCodexHooks.ownership, "managed");
  assert.equal(compiledInspection.runtimeSummary.adapterStates.nativeOpencodeConfig.ownership, "managed");

  const lineageResult = runCli(["inspect", "lineage", specFingerprint, repo, "--json"]);
  const lineageInspection = JSON.parse(lineageResult.stdout);
  assert.equal(lineageInspection.collection, "spec");
  assert.equal(lineageInspection.record.text, "src/app.js should stay on the project runtime surface.");
  assert.equal(lineageInspection.record.kind, "path-rule");
  assert.equal(lineageInspection.evidence.length, 1);
  assert.equal(lineageInspection.evidence[0].summary, "Stable summary.");
  assert.equal(Array.isArray(lineageInspection.edges), true);
});

test("task capture, recall, pending inspection, and promote flow work through the SQLite runtime", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const createResult = runCli(["task", "create", "Auth cleanup", repo, "--slug", "auth-cleanup", "--json"]);
  const createdTask = JSON.parse(createResult.stdout);
  assert.equal(createdTask.taskId, "auth-cleanup");

  const startResult = runCli(["task", "start", "auth-cleanup", repo, "--json"]);
  const startedTask = JSON.parse(startResult.stdout);
  assert.equal(startedTask.taskId, "auth-cleanup");
  assert.equal(startedTask.isActive, true);
  const statusAfterStart = JSON.parse(runCli(["status", repo, "--json"]).stdout);
  assert.equal(statusAfterStart.runtime.activeTask.taskId, "auth-cleanup");

  const configPath = path.join(repo, ".memraft", "config.json");
  const config = readJson(configPath);
  config.merge.minimumGrade = "D";
  config.merge.promotion.minimumOccurrences = 1;
  config.merge.promotion.minimumEvidenceCount = 1;
  config.merge.promotion.minimumConfidence = 0;
  writeJson(configPath, config);

  const { latest } = completeStopSummary(repo, "sess-task-flow", {
    summaryPayload: {
      summary: "Task summary.",
      knowledge: ["src/app.js is part of the project runtime surface."],
      candidate_spec: ["src/app.js should stay on the project runtime surface."],
    },
  });

  assert.equal(latest.taskId, "auth-cleanup");
  assert.equal(latest.merge.appliedToRepoMemory, false);

  const pendingResult = runCli(["inspect", "pending", repo, "--json"]);
  const pending = JSON.parse(pendingResult.stdout);
  assert.equal(Array.isArray(pending), true);
  assert.equal(pending.length, 2);
  assert.equal(pending.every((entry) => entry.collection === "task"), true);

  const recallResult = runCli(["recall", "runtime surface", repo, "--json"]);
  const recallInspection = JSON.parse(recallResult.stdout);
  assert.equal(recallInspection.memories.length > 0, true);
  assert.equal(recallInspection.events.length > 0, true);

  const taskRecallResult = runCli([
    "recall",
    "runtime surface",
    repo,
    "--scope",
    "task",
    "--task",
    "auth-cleanup",
    "--json",
  ]);
  const taskRecallInspection = JSON.parse(taskRecallResult.stdout);
  assert.equal(taskRecallInspection.memories.length, 2);
  assert.equal(taskRecallInspection.events.length >= 1, true);
  assert.equal(
    taskRecallInspection.events.every((entry) => entry.eventId === latest.eventId),
    true,
  );

  const memoryToPromote = pending.find((entry) => entry.record?.targetCollection === "candidateSpec");
  assert.ok(memoryToPromote);

  const promoteResult = runCli(["promote", memoryToPromote.memoryId, repo, "--json"]);
  const promoted = JSON.parse(promoteResult.stdout);
  assert.equal(promoted.promotedCollection, "candidateSpec");
  assert.ok(promoted.promotedMemoryId);

  const rulesInspection = JSON.parse(runCli(["inspect", "rules", repo, "--json"]).stdout);
  assert.equal(rulesInspection.ruleStore.collections.spec.promotedCount, 1);

  const status = JSON.parse(runCli(["status", repo, "--json"]).stdout);
  assert.equal(status.runtime.activeTask.task_id, "auth-cleanup");
  assert.equal(status.runtime.pendingPromotionCount >= 1, true);
  assert.equal(status.runtime.memoryEdgeCount >= 1, true);

  const taskShowResult = runCli(["task", "show", "auth-cleanup", repo, "--json"]);
  const taskDetails = JSON.parse(taskShowResult.stdout);
  assert.equal(taskDetails.events.length >= 1, true);
  assert.equal(taskDetails.memories.length, 2);

  const promotedFingerprint = promoted.record.fingerprint;
  const promotedLineage = JSON.parse(
    runCli(["inspect", "lineage", promotedFingerprint, repo, "--json"]).stdout,
  );
  assert.equal(
    promotedLineage.edges.some((edge) => edge.relationType === "derives"),
    true,
  );

  const finishResult = runCli(["task", "finish", "auth-cleanup", repo, "--json"]);
  const finishedTask = JSON.parse(finishResult.stdout);
  assert.equal(finishedTask.status, "finished");
  assert.equal(finishedTask.isActive, false);
});

test("shared spec proposals can be reviewed and accepted into checked-in spec files", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  updateMemraftConfig(repo, (config) => {
    config.merge.minimumGrade = "D";
    config.merge.promotion.minimumOccurrences = 1;
    config.merge.promotion.minimumEvidenceCount = 1;
    config.merge.promotion.minimumConfidence = 0;
  });

  completeStopSummary(repo, "sess-shared-spec");

  const proposals = JSON.parse(runCli(["inspect", "proposals", repo, "--json"]).stdout);
  const conventionsProposal = proposals.find((entry) => entry.collection === "candidateSpec");
  assert.ok(conventionsProposal);
  assert.equal(conventionsProposal.recommendedSection, "conventions");

  const accepted = JSON.parse(
    runCli([
      "accept",
      conventionsProposal.fingerprint,
      repo,
      "--into",
      "conventions",
      "--json",
    ]).stdout,
  );
  assert.equal(accepted.acceptedInto, "conventions");

  const sharedRegistry = readJson(getSharedRegistryPath(repo));
  const conventionsDoc = readFileSync(getSharedConventionsPath(repo), "utf8");
  const compiledSpec = readFileSync(getCompiledSpecPath(repo), "utf8");
  const toolInjection = readFileSync(getToolInjectionPath(repo), "utf8");
  const status = JSON.parse(runCli(["status", repo, "--json"]).stdout);
  const remainingProposals = JSON.parse(runCli(["inspect", "proposals", repo, "--json"]).stdout);

  assert.equal(Object.keys(sharedRegistry.entries).length, 1);
  assert.match(conventionsDoc, /Keep Memraft summaries JSON-only and subagent-driven/);
  assert.match(compiledSpec, /## Shared Project Spec/);
  assert.match(compiledSpec, /Keep Memraft summaries JSON-only and subagent-driven/);
  assert.match(toolInjection, /Shared project spec:/);
  assert.match(toolInjection, /Keep Memraft summaries JSON-only and subagent-driven/);
  assert.equal(status.sharedSpec.acceptedEntries, 1);
  assert.equal(
    remainingProposals.some((entry) => entry.fingerprint === conventionsProposal.fingerprint),
    false,
  );
});

test("memory relations keep stable canonical edges for contradicts, extends, updates, and supersedes", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const configPath = path.join(repo, ".memraft", "config.json");
  const config = readJson(configPath);
  config.merge.minimumGrade = "D";
  config.merge.promotion.minimumOccurrences = 1;
  config.merge.promotion.minimumEvidenceCount = 1;
  config.merge.promotion.minimumConfidence = 0;
  writeJson(configPath, config);

  runManualCapture(repo, {
    tool: "codex",
    sessionId: "sess-rel-a",
    payload: {
      summary: "First relation.",
      knowledge: [],
      candidate_spec: ["src/app.js should stay on the project runtime surface."],
    },
  });

  runManualCapture(repo, {
    tool: "codex",
    sessionId: "sess-rel-b",
    payload: {
      summary: "Second relation.",
      knowledge: [],
      candidate_spec: ["src/app.js should not stay on the project runtime surface."],
    },
  });

  runManualCapture(repo, {
    tool: "codex",
    sessionId: "sess-rel-c",
    payload: {
      summary: "Extends relation.",
      knowledge: [],
      candidate_spec: ["src/app.js should stay on the project runtime surface and receive runtime changes last."],
    },
  });

  runManualCapture(repo, {
    tool: "codex",
    sessionId: "sess-rel-d",
    payload: {
      summary: "Updates relation.",
      knowledge: [],
      candidate_spec: ["src/app.js should stay on the CLI runtime surface."],
    },
  });

  runManualCapture(repo, {
    tool: "codex",
    sessionId: "sess-rel-e",
    payload: {
      summary: "Supersedes relation.",
      knowledge: [],
      candidate_spec: ["src/app.js must stay on the project runtime surface."],
    },
  });

  const rulesInspection = JSON.parse(runCli(["inspect", "rules", repo, "--json"]).stdout);
  const contradictFingerprint = Object.entries(rulesInspection.ruleStore.collections.spec.records).find(
    ([, record]) => record.text === "src/app.js should stay on the project runtime surface.",
  )[0];

  const lineage = JSON.parse(runCli(["inspect", "lineage", contradictFingerprint, repo, "--json"]).stdout);
  for (const relationType of ["contradicts", "extends", "updates", "supersedes"]) {
    const edge = lineage.edges.find((entry) => entry.relationType === relationType);
    assert.ok(edge, `missing ${relationType} edge`);
    assert.deepEqual(
      [edge.fromMemoryId, edge.toMemoryId],
      [edge.fromMemoryId, edge.toMemoryId].slice().sort(),
      `${relationType} edge should use canonical memory ordering`,
    );
  }
});

test("custom artifact and outbox paths stay functional when kept inside .memraft", () => {
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
      "user.name=Memraft",
      "-c",
      "user.email=memraft@example.com",
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

  const configPath = path.join(repo, ".memraft", "config.json");
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
    existsSync(path.resolve(repo, ".memraft", "artifacts/memory/shared.md")),
    true,
  );
  assert.equal(
    existsSync(path.resolve(repo, ".memraft", "artifacts/specs/candidate.md")),
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

test("path traversal in artifact config is rejected before Memraft writes outside .memraft", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);
  setStopSummaryMode(repo, "full", {
    minimumConversationChars: 1,
  });

  const configPath = path.join(repo, ".memraft", "config.json");
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
    /artifacts\.latestEvidencePath must stay within \.memraft\//,
  );
  assert.equal(existsSync(path.join(repo, "leak.json")), false);

  const statusResult = runCli(["status", repo], { expectSuccess: false });
  assert.notEqual(statusResult.status, 0);
  assert.match(
    statusResult.stderr,
    /artifacts\.latestEvidencePath must stay within \.memraft\//,
  );
});

test("status reports the config path when Memraft config JSON is invalid", () => {
  const repo = makeRepo();
  runCli(["init", repo]);

  const configPath = path.join(repo, ".memraft", "config.json");
  writeFileSync(configPath, "{ invalid json\n", "utf8");

  const statusResult = runCli(["status", repo], { expectSuccess: false });
  assert.notEqual(statusResult.status, 0);
  assert.match(statusResult.stderr, /Failed to parse JSON at /);
  assert.match(statusResult.stderr, new RegExp(escapeRegExp(configPath)));
});

test("inspect latest reads from SQLite runtime even when latest evidence JSON is invalid", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  completeStopSummary(repo, "sess-invalid-latest");
  const latestEvidencePath = getLatestEvidencePath(repo);
  writeFileSync(latestEvidencePath, "{ invalid latest evidence\n", "utf8");

  const inspectResult = runCli(["inspect", "latest", repo, "--json"]);
  const latest = JSON.parse(inspectResult.stdout);
  assert.equal(latest.generator, SUMMARY_AGENT_NAME);
  assert.equal(typeof latest.summary, "string");
});

test("status reads latest and runtime from SQLite even when compatibility JSON views are invalid", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const { latest } = completeStopSummary(repo, "sess-status-sqlite");
  writeFileSync(getLatestEvidencePath(repo), "{ invalid latest evidence\n", "utf8");
  writeFileSync(getRuntimeSummaryPath(repo), "{ invalid runtime summary\n", "utf8");

  const statusResult = runCli(["status", repo, "--json"]);
  const status = JSON.parse(statusResult.stdout);

  assert.equal(status.latestEvidence.eventId, latest.eventId);
  assert.equal(status.runtime.eventCount >= 1, true);
  assert.equal(status.runtime.adapterStates.nativeAgents.ownership, "managed");
  assert.equal(status.runtime.adapterModes.codex.mode, "full");
});

test("default full mode skips short stop summaries even when files changed", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);

  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const stopCommand = getFirstHookCommand(settings, "Stop");
  const assistantMessage = "hi";

  const stopOutput = runJsonHook(stopCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      session_id: "sess-short-default",
      last_assistant_message: assistantMessage,
    },
  });
  assert.deepEqual(stopOutput, { decision: "approve" });
});

test("light stop summary mode approves stop immediately and captures background session-end evidence", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);
  setStopSummaryMode(repo, "light", {
    minimumConversationChars: 1,
  });

  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const stopCommand = getFirstHookCommand(settings, "Stop");
  const assistantMessage = [
    "Keep Memraft summaries JSON-only and subagent-driven.",
    "src/app.js is part of the project runtime surface.",
  ].join(" ");

  const stopOutput = runJsonHook(stopCommand, {
    cwd: repo,
    inputData: {
      cwd: repo,
      session_id: "sess-light",
      last_assistant_message: assistantMessage,
    },
  });
  assert.deepEqual(stopOutput, { decision: "approve" });

  const eventPath = path.join(
    repo,
    ".memraft",
    "state",
    "session-events",
    "manual-light-event.json",
  );
  writeJson(eventPath, {
    eventId: "manual-light-event",
    eventKind: "session_end_fallback",
    createdAt: "2026-03-26T08:00:00Z",
    sessionId: "sess-light",
    reason: "other",
    transcriptPath: "",
    repoRoot: repo,
    assistantMessageExcerpt: assistantMessage,
    assistantMessageChars: assistantMessage.length,
    worktreeFiles: ["src/app.js"],
    worktreeDiff: "$ git diff --stat --unified=0 --no-ext-diff -- .\n src/app.js | 1 +",
    worktreeCapturedAt: "2026-03-26T08:00:00Z",
  });

  const worker = spawnSync(
    "node",
    [path.join(repo, ".memraft", "hooks", "session_end.mjs"), "--worker", "--event-file", eventPath],
    {
      cwd: repo,
      encoding: "utf8",
    },
  );
  assert.equal(worker.status, 0, worker.stderr || worker.stdout);

  const latest = readJson(path.join(repo, ".memraft", "evidence", "latest.json"));
  assert.equal(latest.generator, "session-end-light");
  assert.equal(latest.source.sessionEndLight, true);
  assert.equal(latest.source.stopSummaryMode, "light");
  assert.match(latest.summary, /Deferred Memraft summary captured after session end/);
  assert.deepEqual(latest.knowledge, ["src/app.js is part of the project runtime surface."]);
  assert.deepEqual(latest.candidateSpec, ["Keep Memraft summaries JSON-only and subagent-driven."]);
  assert.equal(existsSync(eventPath), false);
});

test("stop and subagent hooks persist JSON summaries, filter internal files, and honor sync.enabled", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);
  setStopSummaryMode(repo, "full", {
    minimumConversationChars: 1,
  });

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
        candidate_spec: ["Keep Memraft summaries JSON-only and subagent-driven"],
      }),
    },
  });

  const latest = readJson(path.join(repo, ".memraft", "evidence", "latest.json"));
  const summaryState = readJson(path.join(repo, ".memraft", "state", "summary-state.json"));

  assert.equal(stopOutput.decision, "block");
  assert.match(stopOutput.reason, /memraft-memory-summarizer/);
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
    "Keep Memraft summaries JSON-only and subagent-driven",
  ]);
  assert.equal(latest.generator, SUMMARY_AGENT_NAME);
  assert.ok(latest.files.includes("src/app.js"));
  assert.ok(!latest.files.includes("src/later.js"));
  assert.ok(!latest.files.some((file) => file.startsWith(".omc/")));
  assert.ok(!latest.files.some((file) => file.startsWith(".claude/")));
  assert.ok(!latest.files.some((file) => file.startsWith(".memraft/")));
  assert.equal(latest.source.worktreeSnapshotUsed, true);
  assert.match(latest.source.worktreeSnapshotCapturedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(latest.source.diffChars > 0);

  const requests = Object.values(summaryState.requests);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, "completed");
  assert.equal(requests[0].agentId, "agent-1");
  assert.equal(requests[0].evidenceEventId, latest.eventId);

  const outboxFiles = readdirSync(path.join(repo, ".memraft", "sync", "outbox")).filter(
    (name) => name !== ".gitkeep",
  );
  assert.deepEqual(outboxFiles, []);
});

test("session_end completes pending stop summaries with deferred extraction", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);
  setStopSummaryMode(repo, "full", {
    minimumConversationChars: 1,
  });

  const settings = readJson(path.join(repo, ".claude", "settings.json"));
  const stopCommand = getFirstHookCommand(settings, "Stop");
  const assistantMessage = [
    "Keep Memraft summaries JSON-only and subagent-driven.",
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

  const statePath = path.join(repo, ".memraft", "state", "summary-state.json");
  const stateBefore = readJson(statePath);
  const request = Object.values(stateBefore.requests)[0];
  assert.equal(request.status, "pending");

  const eventPath = path.join(
    repo,
    ".memraft",
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
    "node",
    [path.join(repo, ".memraft", "hooks", "session_end.mjs"), "--worker", "--event-file", eventPath],
    {
      cwd: repo,
      encoding: "utf8",
    },
  );
  assert.equal(worker.status, 0, worker.stderr || worker.stdout);

  const latest = readJson(path.join(repo, ".memraft", "evidence", "latest.json"));
  assert.equal(latest.generator, "session-end-deferred");
  assert.equal(latest.source.sessionEndDeferred, true);
  assert.equal(latest.source.summaryRequestId, request.requestId);
  assert.equal(latest.source.sessionEndEventId, "manual-deferred-event");
  assert.match(latest.summary, /Deferred Memraft summary captured after session end/);
  assert.deepEqual(latest.knowledge, ["src/app.js is part of the project runtime surface."]);
  assert.deepEqual(latest.candidateSpec, [
    "Keep Memraft summaries JSON-only and subagent-driven.",
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
  setStopSummaryMode(repo, "full", {
    minimumConversationChars: 1,
  });

  const eventPath = path.join(
    repo,
    ".memraft",
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
    "node",
    [path.join(repo, ".memraft", "hooks", "session_end.mjs"), "--worker", "--event-file", eventPath],
    {
      cwd: repo,
      encoding: "utf8",
    },
  );
  assert.equal(worker.status, 0, worker.stderr || worker.stdout);

  const latest = readJson(path.join(repo, ".memraft", "evidence", "latest.json"));
  assert.equal(latest.generator, "session-end-fallback");
  assert.equal(latest.source.sessionEndFallback, true);
  assert.equal(latest.source.worktreeSnapshotUsed, true);
  assert.equal(latest.source.worktreeSnapshotCapturedAt, "2026-03-26T08:00:00Z");
  assert.match(latest.summary, /completed Memraft subagent summary/);
  assert.deepEqual(latest.files, ["src/app.js"]);
  assert.ok(!latest.files.some((file) => file.startsWith(".omc/")));
  assert.ok(!latest.files.some((file) => file.startsWith(".claude/")));
  assert.ok(!latest.files.some((file) => file.startsWith(".memraft/")));
  assert.equal(existsSync(eventPath), false);
});

test("session_end skips fallback if the session already has a completed stop summary", () => {
  const repo = makeRepo();
  runCli(["init", repo]);
  seedWorktree(repo);
  setStopSummaryMode(repo, "full", {
    minimumConversationChars: 1,
  });

  const { latest, summaryState } = completeStopSummary(repo, "sess-complete");
  summaryState.requests["stale-request"] = {
    requestId: "stale-request",
    sessionId: "sess-complete",
    status: "failed",
    createdAt: "2026-03-26T08:00:01Z",
    updatedAt: "2026-03-26T08:00:02Z",
  };
  writeJson(path.join(repo, ".memraft", "state", "summary-state.json"), summaryState);

  const eventPath = path.join(
    repo,
    ".memraft",
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
    "node",
    [path.join(repo, ".memraft", "hooks", "session_end.mjs"), "--worker", "--event-file", eventPath],
    {
      cwd: repo,
      encoding: "utf8",
    },
  );
  assert.equal(worker.status, 0, worker.stderr || worker.stdout);

  const latestAfterFallback = readJson(path.join(repo, ".memraft", "evidence", "latest.json"));
  assert.equal(latestAfterFallback.eventId, latest.eventId);
  assert.equal(latestAfterFallback.generator, SUMMARY_AGENT_NAME);

  const nextState = readJson(path.join(repo, ".memraft", "state", "summary-state.json"));
  assert.equal(nextState.requests["stale-request"].status, "expired");
  assert.equal(
    nextState.requests["stale-request"].fallbackEventId,
    "manual-complete-event",
  );
  assert.equal(existsSync(eventPath), false);
});
