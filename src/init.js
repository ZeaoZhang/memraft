import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MEMRAFT_DIR = ".memraft";
const CLAUDE_SETTINGS_PATH = path.join(".claude", "settings.json");
const GEMINI_SETTINGS_PATH = path.join(".gemini", "settings.json");
const SESSION_START_MATCHERS = ["startup", "resume", "clear", "compact"];
const PRE_TOOL_USE_MATCHERS = ["Task", "Agent"];
const SUBAGENT_SUMMARIZER_MATCHERS = ["memraft-memory-summarizer"];
const SESSION_END_MATCHERS = [
  "clear",
  "resume",
  "logout",
  "prompt_input_exit",
  "bypass_permissions_disabled",
  "other",
];
const STOP_MATCHERS = [undefined];
const GEMINI_SESSION_START_MATCHERS = ["startup", "resume", "clear"];
const GEMINI_BEFORE_AGENT_MATCHERS = [undefined];
const GEMINI_SESSION_END_MATCHERS = [
  "exit",
  "clear",
  "logout",
  "prompt_input_exit",
  "other",
];
const EXCLUDED_SUFFIXES = [".ts", ".map", ".d.ts", ".py"];
const EXCLUDED_NAMES = new Set(["__pycache__"]);
const TEMPLATE_GROUPS = [
  {
    sourceRoot: path.join(PROJECT_ROOT, "templates", ".memraft"),
    targetRoot: ".memraft",
  },
  {
    sourceRoot: path.join(PROJECT_ROOT, "templates", ".claude"),
    targetRoot: ".claude",
  },
  {
    sourceRoot: path.join(PROJECT_ROOT, "templates", "memraft"),
    targetRoot: "memraft",
  },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getNodeCommand() {
  return "node";
}

function quoteCommandArgument(value) {
  if (process.platform === "win32") {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildHookCommand(
  scriptName,
  projectDirEnvVars = ["CLAUDE_PROJECT_DIR"],
) {
  const projectDirExpression = [
    ...projectDirEnvVars.map((name) => `process.env.${name}`),
    "process.cwd()",
  ].join(" ?? ");
  const nodeCode = [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { pathToFileURL } from 'node:url';",
    `const projectDir = ${projectDirExpression};`,
    "const candidates = [path.resolve(projectDir)];",
    "let cursor = candidates[0];",
    "while (true) {",
    "  const parent = path.dirname(cursor);",
    "  if (parent === cursor) break;",
    "  candidates.push(parent);",
    "  cursor = parent;",
    "}",
    "let hookDir = null;",
    "for (const candidate of candidates) {",
    "  const possible = path.join(candidate, '.memraft', 'hooks');",
    "  if (fs.existsSync(possible) && fs.statSync(possible).isDirectory()) {",
    "    hookDir = possible;",
    "    break;",
    "  }",
    "}",
    "if (!hookDir) process.exit(0);",
    `const mod = await import(pathToFileURL(path.join(hookDir, "${scriptName}")).href);`,
    "const exitCode = await mod.main(process.argv.slice(1));",
    "if (Number.isInteger(exitCode)) process.exit(exitCode);",
  ].join("; ");

  return `${getNodeCommand()} --input-type=module -e ${quoteCommandArgument(nodeCode)}`;
}

function renderTemplate(content, variables) {
  let rendered = content.replaceAll("{{NODE_CMD}}", getNodeCommand());

  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }

  return rendered;
}

function getTemplateVariables(targetDir) {
  const projectName = path.basename(path.resolve(targetDir));
  const projectKey = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return {
    PROJECT_NAME: projectName,
    PROJECT_KEY: projectKey || "repo",
    CREATED_AT: new Date().toISOString(),
  };
}

function listTemplateFiles(sourceRoot, relativeDir = "") {
  const dirPath = path.join(sourceRoot, relativeDir);
  const results = [];

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (EXCLUDED_NAMES.has(entry.name)) {
      continue;
    }

    let shouldExclude = false;
    for (const suffix of EXCLUDED_SUFFIXES) {
      if (entry.name.endsWith(suffix)) {
        shouldExclude = true;
        break;
      }
    }
    if (shouldExclude) {
      continue;
    }

    const relativePath =
      relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;

    if (entry.isDirectory()) {
      results.push(...listTemplateFiles(sourceRoot, relativePath));
      continue;
    }

    results.push(relativePath);
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function shouldPreserveExisting(targetPath, options) {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  if (options.force) {
    return false;
  }

  if (options.skipExisting) {
    return true;
  }

  throw new Error(
    `Refusing to overwrite existing file: ${targetPath}. Re-run with --skip-existing to preserve existing files or --force to overwrite them.`,
  );
}

function findExistingTemplateFiles(targetDir, templateFiles) {
  const existingFiles = [];

  for (const templateFile of templateFiles) {
    const targetPath = path.join(
      targetDir,
      templateFile.targetRoot,
      templateFile.relativePath,
    );
    if (fs.existsSync(targetPath)) {
      existingFiles.push(targetPath);
    }
  }

  return existingFiles;
}

function validateInitOptions(targetDir, templateFiles, options) {
  if (options.force && options.skipExisting) {
    throw new Error("Choose either --force or --skip-existing, not both.");
  }

  if (options.force || options.skipExisting) {
    return;
  }

  const existingFiles = findExistingTemplateFiles(targetDir, templateFiles);
  if (existingFiles.length === 0) {
    return;
  }

  const samplePath = existingFiles[0];
  throw new Error(
    `Found ${existingFiles.length} existing Memraft-managed file(s), starting with ${samplePath}. Re-run with --skip-existing to preserve them or --force to overwrite them.`,
  );
}

function writeRenderedTemplate(targetDir, templateFile, variables, options) {
  const sourcePath = path.join(templateFile.sourceRoot, templateFile.relativePath);
  const targetPath = path.join(
    targetDir,
    templateFile.targetRoot,
    templateFile.relativePath,
  );
  ensureDir(path.dirname(targetPath));

  if (shouldPreserveExisting(targetPath, options)) {
    return false;
  }

  const content = fs.readFileSync(sourcePath, "utf-8");
  fs.writeFileSync(
    targetPath,
    renderTemplate(content, variables),
    "utf-8",
  );

  if (
    templateFile.targetRoot === MEMRAFT_DIR &&
    templateFile.relativePath.startsWith("hooks/")
  ) {
    fs.chmodSync(targetPath, 0o755);
  }

  return true;
}

function ensureGitignoreEntry(targetDir) {
  const gitignorePath = path.join(targetDir, ".gitignore");
  const entry = ".memraft/";

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${entry}\n`, "utf-8");
    return;
  }

  const existing = fs.readFileSync(gitignorePath, "utf-8");
  const lines = existing.split(/\r?\n/);
  if (lines.includes(entry)) {
    return;
  }

  const content = `${existing.replace(/\s*$/, "")}\n${entry}\n`;
  fs.writeFileSync(gitignorePath, content, "utf-8");
}

function readClaudeSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) {
    return {
      hooks: {},
      enabledPlugins: {},
    };
  }

  const raw = fs.readFileSync(settingsPath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse existing Claude settings at ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readGeminiSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) {
    return {
      hooks: {},
    };
  }

  const raw = fs.readFileSync(settingsPath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse existing Gemini settings at ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function createClaudeHook(command, timeout) {
  return {
    type: "command",
    command,
    timeout,
  };
}

function isUniversalMatcher(value) {
  return value == null || value === "" || value === "*";
}

function matchersEquivalent(left, right) {
  if (isUniversalMatcher(left) && isUniversalMatcher(right)) {
    return true;
  }

  return left === right;
}

function isManagedHookCommand(command, scriptName) {
  return typeof command === "string" && command.includes(scriptName);
}

function ensureHookMatcher(settings, eventName, matcher, hook, scriptName) {
  const hookMap = settings.hooks ?? {};
  const eventHooks = Array.isArray(hookMap[eventName]) ? hookMap[eventName] : [];
  const existingMatcher = eventHooks.find((entry) =>
    entry &&
    typeof entry === "object" &&
    matchersEquivalent(entry.matcher, matcher),
  );

  if (!existingMatcher) {
    const matcherGroup = {
      hooks: [hook],
    };
    if (!isUniversalMatcher(matcher)) {
      matcherGroup.matcher = matcher;
    }
    eventHooks.push(matcherGroup);
    hookMap[eventName] = eventHooks;
    settings.hooks = hookMap;
    return;
  }

  const existingHooks = Array.isArray(existingMatcher.hooks)
    ? existingMatcher.hooks
    : [];
  const nextHooks = [];
  let replaced = false;

  for (const entry of existingHooks) {
    if (!entry || typeof entry !== "object") {
      nextHooks.push(entry);
      continue;
    }

    const sameManagedHook =
      entry.type === hook.type && isManagedHookCommand(entry.command, scriptName);
    const sameExactHook =
      entry.command === hook.command && entry.type === hook.type;

    if (!sameManagedHook && !sameExactHook) {
      nextHooks.push(entry);
      continue;
    }

    if (!replaced) {
      nextHooks.push({ ...hook });
      replaced = true;
    }
  }

  if (!replaced) {
    nextHooks.push({ ...hook });
  }

  existingMatcher.hooks = nextHooks;

  hookMap[eventName] = eventHooks;
  settings.hooks = hookMap;
}

function buildClaudeSettings(settings) {
  const nextSettings = {
    ...settings,
    hooks: { ...(settings.hooks ?? {}) },
    enabledPlugins: settings.enabledPlugins ?? {},
  };

  const sessionStartHook = createClaudeHook(
    buildHookCommand("session_start.mjs"),
    10,
  );
  for (const matcher of SESSION_START_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "SessionStart",
      matcher,
      sessionStartHook,
      "session_start.mjs",
    );
  }

  const preToolUseHook = createClaudeHook(
    buildHookCommand("pre_tool_use.mjs"),
    20,
  );
  for (const matcher of PRE_TOOL_USE_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "PreToolUse",
      matcher,
      preToolUseHook,
      "pre_tool_use.mjs",
    );
  }

  const stopHook = createClaudeHook(
    buildHookCommand("stop.mjs"),
    10,
  );
  for (const matcher of STOP_MATCHERS) {
    ensureHookMatcher(nextSettings, "Stop", matcher, stopHook, "stop.mjs");
  }

  const subagentStartHook = createClaudeHook(
    buildHookCommand("subagent_start.mjs"),
    10,
  );
  for (const matcher of SUBAGENT_SUMMARIZER_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "SubagentStart",
      matcher,
      subagentStartHook,
      "subagent_start.mjs",
    );
  }

  const subagentStopHook = createClaudeHook(
    buildHookCommand("subagent_stop.mjs"),
    10,
  );
  for (const matcher of SUBAGENT_SUMMARIZER_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "SubagentStop",
      matcher,
      subagentStopHook,
      "subagent_stop.mjs",
    );
  }

  const sessionEndHook = createClaudeHook(
    buildHookCommand("session_end.mjs"),
    10,
  );
  for (const matcher of SESSION_END_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "SessionEnd",
      matcher,
      sessionEndHook,
      "session_end.mjs",
    );
  }

  return nextSettings;
}

function buildGeminiSettings(settings) {
  const nextSettings = {
    ...settings,
    hooks: { ...(settings.hooks ?? {}) },
  };

  const projectDirEnvVars = ["GEMINI_PROJECT_DIR", "CLAUDE_PROJECT_DIR"];
  const sessionStartHook = createClaudeHook(
    buildHookCommand("session_start.mjs", projectDirEnvVars),
    10,
  );
  for (const matcher of GEMINI_SESSION_START_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "SessionStart",
      matcher,
      sessionStartHook,
      "session_start.mjs",
    );
  }

  const beforeAgentHook = createClaudeHook(
    buildHookCommand("gemini_before_agent.mjs", projectDirEnvVars),
    10,
  );
  for (const matcher of GEMINI_BEFORE_AGENT_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "BeforeAgent",
      matcher,
      beforeAgentHook,
      "gemini_before_agent.mjs",
    );
  }

  const sessionEndHook = createClaudeHook(
    buildHookCommand("session_end.mjs", projectDirEnvVars),
    10,
  );
  for (const matcher of GEMINI_SESSION_END_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "SessionEnd",
      matcher,
      sessionEndHook,
      "session_end.mjs",
    );
  }

  return nextSettings;
}

function upsertClaudeSettings(targetDir) {
  const settingsPath = path.join(targetDir, CLAUDE_SETTINGS_PATH);
  ensureDir(path.dirname(settingsPath));

  const merged = buildClaudeSettings(readClaudeSettings(settingsPath));
  fs.writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
}

function upsertGeminiSettings(targetDir) {
  const settingsPath = path.join(targetDir, GEMINI_SETTINGS_PATH);
  ensureDir(path.dirname(settingsPath));

  const merged = buildGeminiSettings(readGeminiSettings(settingsPath));
  fs.writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
}

function bootstrapCompiledArtifacts(targetDir) {
  const nodeCode = [
    "import path from 'node:path';",
    "import { pathToFileURL } from 'node:url';",
    "const repoRoot = path.resolve(process.argv[1]);",
    "const mod = await import(pathToFileURL(path.join(repoRoot, '.memraft', 'hooks', 'runtime.mjs')).href);",
    "await mod.ensureCompiledArtifacts(repoRoot);",
  ].join("; ");
  const result = spawnSync(
    getNodeCommand(),
    ["--input-type=module", "-e", nodeCode, targetDir],
    {
      cwd: targetDir,
      encoding: "utf-8",
    },
  );

  if (result.status === 0) {
    return;
  }

  const details = [result.stderr, result.stdout]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n")
    .trim();
  throw new Error(
    `Failed to bootstrap compiled Memraft artifacts in ${targetDir}${details ? `:\n${details}` : "."}`,
  );
}

export async function initMemraft(options = {}) {
  const targetDir = path.resolve(options.targetDir ?? process.cwd());
  const variables = getTemplateVariables(targetDir);
  const templateFiles = TEMPLATE_GROUPS.flatMap((group) =>
    listTemplateFiles(group.sourceRoot).map((relativePath) => ({
      sourceRoot: group.sourceRoot,
      targetRoot: group.targetRoot,
      relativePath,
    })),
  );
  validateInitOptions(targetDir, templateFiles, options);

  console.log(`Initializing Memraft in ${targetDir}`);

  let written = 0;
  let preserved = 0;
  for (const templateFile of templateFiles) {
    const didWrite = writeRenderedTemplate(
      targetDir,
      templateFile,
      variables,
      options,
    );
    if (didWrite) {
      written += 1;
    } else {
      preserved += 1;
    }
  }

  ensureGitignoreEntry(targetDir);
  upsertClaudeSettings(targetDir);
  upsertGeminiSettings(targetDir);
  bootstrapCompiledArtifacts(targetDir);

  console.log(`Template files written: ${written}`);
  console.log(`Existing files preserved: ${preserved}`);
  console.log("Claude hooks merged into .claude/settings.json");
  console.log("Gemini hooks merged into .gemini/settings.json");
  console.log("Native instruction entrypoints synced.");
  console.log("Shared spec templates synced under memraft/spec.");
  console.log("Memraft ready.");
}
