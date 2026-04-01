import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const TEAMAI_DIR = ".teamai";
const CLAUDE_SETTINGS_PATH = path.join(".claude", "settings.json");
const SESSION_START_MATCHERS = ["startup", "resume", "clear", "compact"];
const PRE_TOOL_USE_MATCHERS = ["Task", "Agent"];
const SUBAGENT_SUMMARIZER_MATCHERS = ["teamai-memory-summarizer"];
const SESSION_END_MATCHERS = [
  "clear",
  "resume",
  "logout",
  "prompt_input_exit",
  "bypass_permissions_disabled",
  "other",
];
const STOP_MATCHERS = [undefined];
const EXCLUDED_SUFFIXES = [".ts", ".js", ".map", ".d.ts"];
const EXCLUDED_NAMES = new Set(["__pycache__"]);
const TEMPLATE_GROUPS = [
  {
    sourceRoot: path.join(PROJECT_ROOT, "templates", ".teamai"),
    targetRoot: ".teamai",
  },
  {
    sourceRoot: path.join(PROJECT_ROOT, "templates", ".claude"),
    targetRoot: ".claude",
  },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getPythonCommand() {
  return process.platform === "win32" ? "python" : "python3";
}

function quoteCommandArgument(value) {
  if (process.platform === "win32") {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildHookCommand(scriptName) {
  const moduleName = scriptName.replace(/\.py$/i, "");
  const pythonCode = [
    "import os, sys",
    'hook_dir = os.path.join(os.environ["CLAUDE_PROJECT_DIR"], ".teamai", "hooks")',
    "sys.path.insert(0, hook_dir)",
    `import ${moduleName} as teamai_hook`,
    "teamai_hook.main()",
  ].join("; ");

  return `${getPythonCommand()} -c ${quoteCommandArgument(pythonCode)}`;
}

function renderTemplate(content, variables) {
  let rendered = content.replaceAll("{{PYTHON_CMD}}", getPythonCommand());

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
    `Found ${existingFiles.length} existing TeamAI file(s), starting with ${samplePath}. Re-run with --skip-existing to preserve them or --force to overwrite them.`,
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
    templateFile.targetRoot === TEAMAI_DIR &&
    templateFile.relativePath.startsWith("hooks/")
  ) {
    fs.chmodSync(targetPath, 0o755);
  }

  return true;
}

function ensureGitignoreEntry(targetDir) {
  const gitignorePath = path.join(targetDir, ".gitignore");
  const entry = ".teamai/";

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
    buildHookCommand("session_start.py"),
    10,
  );
  for (const matcher of SESSION_START_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "SessionStart",
      matcher,
      sessionStartHook,
      "session_start.py",
    );
  }

  const preToolUseHook = createClaudeHook(
    buildHookCommand("pre_tool_use.py"),
    20,
  );
  for (const matcher of PRE_TOOL_USE_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "PreToolUse",
      matcher,
      preToolUseHook,
      "pre_tool_use.py",
    );
  }

  const stopHook = createClaudeHook(
    buildHookCommand("stop.py"),
    10,
  );
  for (const matcher of STOP_MATCHERS) {
    ensureHookMatcher(nextSettings, "Stop", matcher, stopHook, "stop.py");
  }

  const subagentStartHook = createClaudeHook(
    buildHookCommand("subagent_start.py"),
    10,
  );
  for (const matcher of SUBAGENT_SUMMARIZER_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "SubagentStart",
      matcher,
      subagentStartHook,
      "subagent_start.py",
    );
  }

  const subagentStopHook = createClaudeHook(
    buildHookCommand("subagent_stop.py"),
    10,
  );
  for (const matcher of SUBAGENT_SUMMARIZER_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "SubagentStop",
      matcher,
      subagentStopHook,
      "subagent_stop.py",
    );
  }

  const sessionEndHook = createClaudeHook(
    buildHookCommand("session_end.py"),
    10,
  );
  for (const matcher of SESSION_END_MATCHERS) {
    ensureHookMatcher(
      nextSettings,
      "SessionEnd",
      matcher,
      sessionEndHook,
      "session_end.py",
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

export async function initTeamai(options = {}) {
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

  console.log(`Initializing TeamAI Local MVP in ${targetDir}`);

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

  console.log(`Template files written: ${written}`);
  console.log(`Existing files preserved: ${preserved}`);
  console.log("Claude hooks merged into .claude/settings.json");
  console.log("TeamAI Local MVP ready.");
}
