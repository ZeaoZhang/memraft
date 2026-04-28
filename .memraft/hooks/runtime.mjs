#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MEMRAFT_DIR = ".memraft";
const SCHEMA_VERSION = 2;
const SUMMARY_AGENT_NAME = "memraft-memory-summarizer";
const COMPILE_STATE_VERSION = 1;
const MAX_COMPILE_CACHE_RECENT_FILES = 8;
const AUTO_CAPTURE_STATE_PATH = path.join(MEMRAFT_DIR, "state", "auto-capture-state.json");
const DEFAULT_PROMOTION_RULES = {
  minimumOccurrences: 2,
  minimumEvidenceCount: 2,
  minimumConfidence: 0.68,
};
const DEFAULT_CAPTURE_CONFIG = {
  excludePathPrefixes: [
    `${MEMRAFT_DIR}/`,
    ".omc/",
    ".claude/",
    ".codex/",
    ".opencode/",
    ".git/",
    "AGENTS.md",
    "GEMINI.md",
    "opencode.json",
  ],
  maxTranscriptChars: 18_000,
  maxDiffChars: 14_000,
};
const DEFAULT_STOP_SUMMARY_CONFIG = {
  enabled: true,
  agentName: SUMMARY_AGENT_NAME,
  minimumAssistantChars: 450,
  minimumChangedFiles: 1,
  allowWithoutChanges: true,
  maxBlockAttempts: 2,
  maxReasonChars: 2400,
  maxAssistantExcerptChars: 2400,
  maxFilesInReason: 12,
};
const GRADE_ORDER = { D: 0, C: 1, B: 2, A: 3 };
const EMPTY_SECTION_LINES = new Set([
  "no promoted entries yet.",
  "- no promoted entries yet.",
  "no candidate entries yet.",
  "- no candidate entries yet.",
]);
const DEFERRED_SPEC_KEYWORDS = [
  "should",
  "must",
  "always",
  "never",
  "keep",
  "use",
  "prefer",
  "avoid",
  "return",
  "only",
  "do not",
];
const DEFERRED_KNOWLEDGE_HINTS = [
  " is ",
  " are ",
  " uses ",
  " contains ",
  " stores ",
  " reads ",
  " writes ",
  " handles ",
  " runs ",
  " part of ",
];
const FILE_PATH_PATTERN =
  /(?:^|[\s`"'])(?:((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+))/g;
const RULE_TOOL_PATTERNS = [
  ["claude-code", ["claude code", "claude"]],
  ["codex", ["codex"]],
  ["gemini-cli", ["gemini cli", "gemini"]],
  ["opencode", ["opencode", "open code"]],
  ["memraft", ["memraft"]],
  ["git", ["git"]],
  ["pnpm", ["pnpm"]],
  ["npm", ["npm"]],
  ["yarn", ["yarn"]],
  ["bun", ["bun"]],
  ["python", ["python", "pyproject", "pip"]],
  ["node", ["node", "javascript", "typescript"]],
];
const RULE_REQUIREMENT_ALIASES = {
  packageManagers: {
    pnpm: "pnpm",
    npm: "npm",
    yarn: "yarn",
    bun: "bun",
  },
  languages: {
    typescript: "typescript",
    javascript: "javascript",
    python: "python",
    rust: "rust",
    go: "go",
  },
  frameworks: {
    "next js": "Next.js",
    react: "React",
    vue: "Vue",
    svelte: "Svelte",
    astro: "Astro",
    express: "Express",
    fastify: "Fastify",
    nestjs: "NestJS",
    "nest js": "NestJS",
  },
  tooling: {
    typescript: "TypeScript",
    biome: "Biome",
    prettier: "Prettier",
    eslint: "ESLint",
    vitest: "Vitest",
    jest: "Jest",
    playwright: "Playwright",
    turborepo: "Turborepo",
    turbo: "Turborepo",
    nx: "Nx",
  },
  workspaceTypes: {
    monorepo: "monorepo",
    "single package": "single-package",
    "single-package": "single-package",
  },
};
const RELATION_SOURCES = new Set(["task-promotion", "auto-relation"]);
const MODAL_STRENGTH = new Map([
  ["can", 0],
  ["could", 0],
  ["may", 0],
  ["should", 1],
  ["need to", 2],
  ["needs to", 2],
  ["must", 3],
]);
const PREFERRED_TEXT_KEYS = [
  "message",
  "summary",
  "content",
  "text",
  "output",
  "response",
  "assistant",
  "details",
];
const REPO_PATH_KEYS = [
  "cwd",
  "repoRoot",
  "repo_root",
  "projectPath",
  "project_path",
  "workspace",
  "workspacePath",
  "workspace_path",
];
const SESSION_ID_KEYS = [
  "session_id",
  "sessionId",
  "conversation_id",
  "conversationId",
  "run_id",
  "runId",
  "id",
];
const TRANSCRIPT_PATH_KEYS = [
  "transcript_path",
  "transcriptPath",
  "transcript",
  "transcript_file",
  "transcriptFile",
];
const TOKEN_RE = /\w{2,}/gu;
const MANAGED_BLOCK_PREFIX = "<!-- MEMRAFT:BEGIN ";
const MANAGED_BLOCK_SUFFIX = " -->";
const MANAGED_BLOCK_END_PREFIX = "<!-- MEMRAFT:END ";

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonDumps(value) {
  return stableJsonStringify(value);
}

function jsonLoads(value, fallback) {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function compactTimestamp(isoValue) {
  return isoValue.replaceAll("-", "").replaceAll(":", "");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function tailText(filePath, maxChars = 4000) {
  const content = readText(filePath, "");
  if (content.length <= maxChars) {
    return content;
  }
  return content.slice(-maxChars);
}

function readJson(filePath) {
  const content = readText(filePath, "");
  if (!content.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function findRepoRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".git")) || fs.existsSync(path.join(current, MEMRAFT_DIR))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
}

function readMarkdownSection(filePath, heading) {
  const content = readText(filePath, "");
  if (!content.trim()) {
    return "";
  }
  const lines = content.split(/\r?\n/);
  const targetHeading = `## ${heading}`.trim();
  let inSection = false;
  const sectionLines = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (inSection) {
        break;
      }
      inSection = line.trim() === targetHeading;
      continue;
    }
    if (inSection) {
      sectionLines.push(line);
    }
  }
  return sectionLines.join("\n").trim();
}

function normalizeText(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[`*_#>\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprintText(text) {
  return crypto.createHash("sha256").update(normalizeText(text), "utf8").digest("hex");
}

function slugify(text, fallback = "item") {
  const slug = text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function prepareInjectedSection(text, { maxLines = 24, maxChars = 2400 } = {}) {
  if (!text.trim()) {
    return "";
  }
  const filteredLines = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      continue;
    }
    if (EMPTY_SECTION_LINES.has(normalizeText(line))) {
      continue;
    }
    filteredLines.push(line);
  }
  if (filteredLines.length === 0) {
    return "";
  }
  let trimmed = filteredLines.slice(0, maxLines).join("\n").trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  trimmed = trimmed.slice(0, maxChars).trimEnd();
  if (trimmed.includes("\n")) {
    trimmed = trimmed.slice(0, trimmed.lastIndexOf("\n")).trimEnd();
  }
  return trimmed;
}

function runCommand(cmd, cwd, timeout = 30_000, env = process.env) {
  try {
    const result = spawnSync(cmd[0], cmd.slice(1), {
      cwd,
      env,
      encoding: "utf8",
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return [result.status ?? 1, result.stdout ?? "", result.stderr ?? ""];
  } catch (error) {
    return [1, "", error instanceof Error ? error.message : String(error)];
  }
}

function hashJsonPayload(value) {
  return crypto.createHash("sha256").update(stableJsonStringify(value), "utf8").digest("hex");
}

function getStringValue(data, ...keys) {
  if (!data || typeof data !== "object") {
    return "";
  }
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return "";
}

function getBoolValue(data, ...keys) {
  if (!data || typeof data !== "object") {
    return false;
  }
  for (const key of keys) {
    if (typeof data[key] === "boolean") {
      return data[key];
    }
  }
  return false;
}

function getSessionId(inputData) {
  return getStringValue(inputData, "session_id", "sessionId") || "unknown-session";
}

function getTranscriptPath(inputData) {
  const value = getStringValue(inputData, "transcript_path", "transcriptPath");
  return value ? path.resolve(value.replace(/^~(?=$|\/|\\)/, os.homedir())) : "";
}

function getReason(inputData, fallback) {
  return getStringValue(inputData, "reason", "sessionReason") || fallback;
}

function getLastAssistantMessage(inputData) {
  return getStringValue(
    inputData,
    "last_assistant_message",
    "lastAssistantMessage",
    "assistant_message",
    "assistantMessage",
  );
}

function getAgentType(inputData) {
  return getStringValue(
    inputData,
    "subagent_type",
    "subagentType",
    "agent_type",
    "agentType",
  );
}

function getAgentId(inputData) {
  return getStringValue(
    inputData,
    "subagent_id",
    "subagentId",
    "agent_id",
    "agentId",
  );
}

function getStopHookActive(inputData) {
  return getBoolValue(inputData, "stop_hook_active", "stopHookActive");
}

function buildEvent(inputData, repoRoot, { eventKind, messageFingerprint = "", snapshot = null }) {
  const createdAt = nowIso();
  const sessionId = getSessionId(inputData);
  const transcriptPath = getTranscriptPath(inputData);
  const eventSeed = [
    eventKind,
    sessionId,
    messageFingerprint || "no-message",
    createdAt,
  ].join("|");
  const eventId = `${compactTimestamp(createdAt)}_${fingerprintText(eventSeed).slice(0, 8)}`;
  const event = {
    eventId,
    eventKind,
    createdAt,
    sessionId,
    reason: getReason(inputData, eventKind),
    transcriptPath,
    repoRoot,
  };
  if (snapshot && typeof snapshot === "object") {
    if (Array.isArray(snapshot.worktreeFiles)) {
      event.worktreeFiles = snapshot.worktreeFiles.filter((item) => typeof item === "string" && item);
    }
    if (typeof snapshot.worktreeDiff === "string") {
      event.worktreeDiff = snapshot.worktreeDiff;
    }
    if (typeof snapshot.capturedAt === "string" && snapshot.capturedAt) {
      event.worktreeCapturedAt = snapshot.capturedAt;
    }
  }
  return event;
}

function loadConfig(repoRoot) {
  return readJson(path.join(repoRoot, MEMRAFT_DIR, "config.json")) ?? {};
}

function getCompiledStatePath(repoRoot) {
  return path.join(repoRoot, MEMRAFT_DIR, "state", "compiled-state.json");
}

function loadCompiledState(repoRoot) {
  return readJson(getCompiledStatePath(repoRoot)) ?? {};
}

function getCaptureConfig(config) {
  const capture = config?.capture;
  const nextConfig = { ...DEFAULT_CAPTURE_CONFIG };
  if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
    return nextConfig;
  }
  if (Array.isArray(capture.excludePathPrefixes)) {
    const seen = new Set(nextConfig.excludePathPrefixes);
    const cleaned = [...nextConfig.excludePathPrefixes];
    for (const item of capture.excludePathPrefixes) {
      if (typeof item !== "string") {
        continue;
      }
      let normalized = item.trim().replaceAll("\\", "/").replace(/^\.?\//, "");
      if (!normalized) {
        continue;
      }
      if (item.endsWith("/") && !normalized.endsWith("/")) {
        normalized = `${normalized}/`;
      }
      if (!seen.has(normalized)) {
        seen.add(normalized);
        cleaned.push(normalized);
      }
    }
    nextConfig.excludePathPrefixes = cleaned;
  }
  for (const key of ["maxTranscriptChars", "maxDiffChars"]) {
    if (Number.isInteger(capture[key]) && capture[key] > 0) {
      nextConfig[key] = capture[key];
    }
  }
  return nextConfig;
}

function getStopSummaryConfig(config) {
  const stopSummary = config?.stopSummary;
  const nextConfig = { ...DEFAULT_STOP_SUMMARY_CONFIG };
  if (!stopSummary || typeof stopSummary !== "object" || Array.isArray(stopSummary)) {
    return nextConfig;
  }
  if (typeof stopSummary.enabled === "boolean") {
    nextConfig.enabled = stopSummary.enabled;
  }
  for (const key of [
    "minimumAssistantChars",
    "minimumChangedFiles",
    "maxBlockAttempts",
    "maxReasonChars",
    "maxAssistantExcerptChars",
    "maxFilesInReason",
  ]) {
    if (Number.isInteger(stopSummary[key]) && stopSummary[key] > 0) {
      nextConfig[key] = stopSummary[key];
    }
  }
  if (typeof stopSummary.allowWithoutChanges === "boolean") {
    nextConfig.allowWithoutChanges = stopSummary.allowWithoutChanges;
  }
  return nextConfig;
}

function getPromotionRules(config) {
  const merge = config?.merge;
  const promotion = merge?.promotion;
  const rules = { ...DEFAULT_PROMOTION_RULES };
  if (!promotion || typeof promotion !== "object" || Array.isArray(promotion)) {
    return rules;
  }
  if (Number.isInteger(promotion.minimumOccurrences) && promotion.minimumOccurrences > 0) {
    rules.minimumOccurrences = promotion.minimumOccurrences;
  }
  if (Number.isInteger(promotion.minimumEvidenceCount) && promotion.minimumEvidenceCount > 0) {
    rules.minimumEvidenceCount = promotion.minimumEvidenceCount;
  }
  if (typeof promotion.minimumConfidence === "number") {
    rules.minimumConfidence = Number(Math.max(0, Math.min(promotion.minimumConfidence, 1)).toFixed(2));
  }
  return rules;
}

function resolveMemraftPath(repoRoot, relativePath, { label }) {
  const memraftRoot = path.resolve(repoRoot, MEMRAFT_DIR);
  const candidate = path.resolve(memraftRoot, relativePath);
  const relativeToRoot = path.relative(memraftRoot, candidate);
  const escapesRoot =
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot);
  if (escapesRoot) {
    throw new Error(`${label} must stay within ${MEMRAFT_DIR}/ (received: ${relativePath})`);
  }
  return candidate;
}

function getArtifactPath(repoRoot, config, key, fallback) {
  const artifacts = config?.artifacts;
  if (artifacts && typeof artifacts === "object" && typeof artifacts[key] === "string" && artifacts[key]) {
    return resolveMemraftPath(repoRoot, artifacts[key], { label: `artifacts.${key}` });
  }
  return resolveMemraftPath(repoRoot, fallback, { label: `artifacts.${key}` });
}

function readArtifactJson(repoRoot, config, key, fallback) {
  return readJson(getArtifactPath(repoRoot, config, key, fallback)) ?? {};
}

function getCompileOutputPaths(repoRoot, config) {
  return {
    repoProfile: getArtifactPath(repoRoot, config, "repoProfilePath", "state/repo-profile.json"),
    ruleStore: getArtifactPath(repoRoot, config, "ruleStorePath", "state/rule-store.json"),
    compiledSpec: getArtifactPath(repoRoot, config, "compiledSpecPath", "generated/spec.md"),
    sessionStartInjection: getArtifactPath(
      repoRoot,
      config,
      "sessionStartInjectionPath",
      "generated/inject/session-start.txt",
    ),
    toolInjection: getArtifactPath(repoRoot, config, "toolInjectionPath", "generated/inject/tool-task.txt"),
    subagentInjection: getArtifactPath(
      repoRoot,
      config,
      "subagentInjectionPath",
      "generated/inject/subagent.txt",
    ),
    adapterManifest: resolveMemraftPath(repoRoot, "generated/adapters/manifest.json", {
      label: "generated.adapters.manifest",
    }),
    codexAgents: resolveMemraftPath(repoRoot, "generated/adapters/codex/AGENTS.md", {
      label: "generated.adapters.codex",
    }),
    codexConfig: resolveMemraftPath(repoRoot, "generated/adapters/codex/config.toml", {
      label: "generated.adapters.codexConfig",
    }),
    geminiContext: resolveMemraftPath(repoRoot, "generated/adapters/gemini/GEMINI.md", {
      label: "generated.adapters.gemini",
    }),
    opencodeAgents: resolveMemraftPath(repoRoot, "generated/adapters/opencode/AGENTS.md", {
      label: "generated.adapters.opencode",
    }),
    opencodeConfig: resolveMemraftPath(repoRoot, "generated/adapters/opencode/opencode.json", {
      label: "generated.adapters.opencodeConfig",
    }),
    opencodePlugin: resolveMemraftPath(
      repoRoot,
      "generated/adapters/opencode/memraft-auto-capture.js",
      { label: "generated.adapters.opencodePlugin" },
    ),
  };
}

function validateConfiguredPaths(repoRoot, config) {
  const defaults = {
    memoryPath: "knowledge/memory.md",
    candidateSpecPath: "specs/candidate-spec.md",
    latestEvidencePath: "evidence/latest.json",
    repoProfilePath: "state/repo-profile.json",
    ruleStorePath: "state/rule-store.json",
    compiledSpecPath: "generated/spec.md",
    sessionStartInjectionPath: "generated/inject/session-start.txt",
    toolInjectionPath: "generated/inject/tool-task.txt",
    subagentInjectionPath: "generated/inject/subagent.txt",
  };
  for (const [key, fallback] of Object.entries(defaults)) {
    getArtifactPath(repoRoot, config, key, fallback);
  }
  const sync = config?.sync;
  if (sync && typeof sync === "object" && typeof sync.outboxDir === "string" && sync.outboxDir) {
    resolveMemraftPath(repoRoot, sync.outboxDir, { label: "sync.outboxDir" });
  }
}

function compileOutputsExist(paths) {
  return Object.values(paths).every((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function uniqueStrings(values) {
  const seen = new Set();
  const ordered = [];
  for (const value of values) {
    const cleaned = typeof value === "string" ? value.trim() : "";
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    ordered.push(cleaned);
  }
  return ordered;
}

function collectPackageNames(packageJson) {
  const packages = new Set();
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const value = packageJson?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    for (const packageName of Object.keys(value)) {
      if (packageName) {
        packages.add(packageName);
      }
    }
  }
  return packages;
}

function detectPackageManagers(repoRoot, packageJson) {
  const detected = [];
  const packageManager = getStringValue(packageJson, "packageManager");
  if (packageManager) {
    detected.push(packageManager.split("@", 1)[0]);
  }
  const lockfiles = [
    ["bun", "bun.lock"],
    ["bun", "bun.lockb"],
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["npm", "package-lock.json"],
  ];
  for (const [manager, filename] of lockfiles) {
    if (fs.existsSync(path.join(repoRoot, filename))) {
      detected.push(manager);
    }
  }
  return uniqueStrings(detected);
}

function inferWorkspaceType(repoRoot, packageJson) {
  if (
    fs.existsSync(path.join(repoRoot, "pnpm-workspace.yaml")) ||
    fs.existsSync(path.join(repoRoot, "turbo.json")) ||
    fs.existsSync(path.join(repoRoot, "nx.json"))
  ) {
    return "monorepo";
  }
  const workspaces = packageJson?.workspaces;
  if ((Array.isArray(workspaces) && workspaces.length > 0) || (workspaces && typeof workspaces === "object")) {
    return "monorepo";
  }
  return "single-package";
}

function inferRepoLanguages(repoRoot, packageJson, packageNames) {
  const languages = [];
  if (packageJson && typeof packageJson === "object" && Object.keys(packageJson).length > 0) {
    languages.push("javascript");
  }
  let hasTypeScript = fs.existsSync(path.join(repoRoot, "tsconfig.json")) || packageNames.has("typescript");
  if (!hasTypeScript && fs.existsSync(path.join(repoRoot, "src"))) {
    try {
      hasTypeScript = fs.readdirSync(path.join(repoRoot, "src")).some((entry) => /\.(ts|tsx)$/.test(entry));
    } catch {}
  }
  if (hasTypeScript) {
    languages.push("typescript");
  }
  if (
    fs.existsSync(path.join(repoRoot, "pyproject.toml")) ||
    fs.existsSync(path.join(repoRoot, "requirements.txt"))
  ) {
    languages.push("python");
  }
  if (fs.existsSync(path.join(repoRoot, "Cargo.toml"))) {
    languages.push("rust");
  }
  if (fs.existsSync(path.join(repoRoot, "go.mod"))) {
    languages.push("go");
  }
  return uniqueStrings(languages);
}

function inferFrameworks(packageNames) {
  const mapping = {
    next: "Next.js",
    react: "React",
    vue: "Vue",
    svelte: "Svelte",
    astro: "Astro",
    express: "Express",
    fastify: "Fastify",
    "@nestjs/core": "NestJS",
  };
  const detected = [];
  for (const [packageName, label] of Object.entries(mapping)) {
    if (packageNames.has(packageName)) {
      detected.push(label);
    }
  }
  return uniqueStrings(detected);
}

function inferTooling(repoRoot, packageNames, workspaceType) {
  const tooling = [];
  const fileMarkers = [
    ["tsconfig.json", "TypeScript"],
    ["biome.json", "Biome"],
    [".prettierrc", "Prettier"],
    ["prettier.config.js", "Prettier"],
    ["eslint.config.js", "ESLint"],
    [".eslintrc", "ESLint"],
    ["vitest.config.ts", "Vitest"],
    ["jest.config.js", "Jest"],
    ["playwright.config.ts", "Playwright"],
    ["turbo.json", "Turborepo"],
    ["nx.json", "Nx"],
  ];
  for (const [filename, label] of fileMarkers) {
    if (fs.existsSync(path.join(repoRoot, filename))) {
      tooling.push(label);
    }
  }
  const dependencyMarkers = {
    typescript: "TypeScript",
    eslint: "ESLint",
    prettier: "Prettier",
    vitest: "Vitest",
    jest: "Jest",
    "@playwright/test": "Playwright",
    turbo: "Turborepo",
    nx: "Nx",
  };
  for (const [packageName, label] of Object.entries(dependencyMarkers)) {
    if (packageNames.has(packageName)) {
      tooling.push(label);
    }
  }
  if (workspaceType === "monorepo") {
    tooling.push("Workspace orchestration");
  }
  return uniqueStrings(tooling);
}

function inferCommands(packageJson, packageManagers) {
  const commands = {};
  const scripts = packageJson?.scripts;
  if (scripts && typeof scripts === "object" && !Array.isArray(scripts)) {
    for (const key of ["dev", "start", "build", "test", "lint", "typecheck", "check", "format"]) {
      const value = scripts[key];
      if (typeof value === "string" && value.trim()) {
        commands[key] = value.trim();
      }
    }
  }
  if (packageManagers.length > 0) {
    const installCommands = {
      bun: "bun install",
      pnpm: "pnpm install",
      yarn: "yarn install",
      npm: "npm install",
    };
    const installCommand = installCommands[packageManagers[0]];
    if (installCommand) {
      commands.install ??= installCommand;
    }
  }
  return commands;
}

function scanRepoProfile(repoRoot, config) {
  const packageJson = readJson(path.join(repoRoot, "package.json")) ?? {};
  const packageNames = collectPackageNames(packageJson);
  const packageManagers = detectPackageManagers(repoRoot, packageJson);
  const workspaceType = inferWorkspaceType(repoRoot, packageJson);
  return {
    version: 1,
    projectName: getStringValue(config, "projectName") || path.basename(repoRoot) || "repo",
    repoRoot,
    scannedAt: nowIso(),
    workspaceType,
    languages: inferRepoLanguages(repoRoot, packageJson, packageNames),
    packageManagers,
    frameworks: inferFrameworks(packageNames),
    tooling: inferTooling(repoRoot, packageNames, workspaceType),
    commands: inferCommands(packageJson, packageManagers),
  };
}

function stabilizeRepoProfile(repoRoot, config, repoProfile) {
  const existing = readArtifactJson(repoRoot, config, "repoProfilePath", "state/repo-profile.json");
  if (!existing || Object.keys(existing).length === 0) {
    return repoProfile;
  }
  const existingCompare = { ...existing };
  const nextCompare = { ...repoProfile };
  delete existingCompare.scannedAt;
  delete nextCompare.scannedAt;
  return stableJsonStringify(existingCompare) === stableJsonStringify(nextCompare) ? existing : repoProfile;
}

function getSessionEvidencePath(repoRoot, eventId) {
  return path.join(repoRoot, MEMRAFT_DIR, "evidence", "sessions", `${eventId}.json`);
}

function wasProcessed(repoRoot, eventId) {
  return fs.existsSync(getSessionEvidencePath(repoRoot, eventId));
}

function isExcludedPath(pathValue, excludedPrefixes) {
  const normalized = pathValue.trim().replaceAll("\\", "/").replace(/^\.?\//, "");
  if (!normalized) {
    return false;
  }
  for (const prefix of excludedPrefixes) {
    const cleanPrefix = prefix.replace(/\/$/, "");
    if (normalized === cleanPrefix || normalized.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function getWorktreeFiles(repoRoot, excludedPrefixes) {
  const [code, stdout] = runCommand(["git", "status", "--short", "--untracked-files=all"], repoRoot);
  if (code !== 0) {
    return [];
  }
  const files = [];
  const seen = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length < 4) {
      continue;
    }
    let filePart = line.slice(3).trim();
    if (filePart.includes(" -> ")) {
      filePart = filePart.split(" -> ", 2)[1];
    }
    filePart = filePart.replace(/^"|"$/g, "");
    if (!filePart || seen.has(filePart) || isExcludedPath(filePart, excludedPrefixes)) {
      continue;
    }
    seen.add(filePart);
    files.push(filePart);
  }
  return files;
}

function getUntrackedWorktreeFiles(repoRoot, excludedPrefixes) {
  const [code, stdout] = runCommand(["git", "ls-files", "--others", "--exclude-standard", "--", "."], repoRoot);
  if (code !== 0) {
    return [];
  }
  const files = [];
  const seen = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    const filePath = line.trim().replace(/^"|"$/g, "");
    if (!filePath || seen.has(filePath) || isExcludedPath(filePath, excludedPrefixes)) {
      continue;
    }
    seen.add(filePath);
    files.push(filePath);
  }
  return files;
}

function buildDiffCommand(baseCommand, excludedPrefixes) {
  const command = [...baseCommand, "--", "."];
  for (const prefix of excludedPrefixes) {
    const cleanPrefix = prefix.replace(/\/$/, "");
    command.push(prefix.endsWith("/") ? `:(exclude)${cleanPrefix}/**` : `:(exclude)${cleanPrefix}`);
  }
  return command;
}

function getWorktreeDiff(repoRoot, maxChars, excludedPrefixes) {
  const segments = [];
  const commands = [
    buildDiffCommand(["git", "diff", "--stat", "--unified=0", "--no-ext-diff"], excludedPrefixes),
    buildDiffCommand(["git", "diff", "--cached", "--stat", "--unified=0", "--no-ext-diff"], excludedPrefixes),
  ];
  for (const command of commands) {
    const [code, stdout] = runCommand(command, repoRoot, 60_000);
    if (code === 0 && stdout.trim()) {
      segments.push(`$ ${command.join(" ")}\n${stdout.trim()}`);
    }
  }
  const untrackedFiles = getUntrackedWorktreeFiles(repoRoot, excludedPrefixes);
  if (untrackedFiles.length > 0) {
    const lines = ["$ git ls-files --others --exclude-standard -- ."];
    for (const filePath of untrackedFiles.slice(0, 20)) {
      const absolutePath = path.join(repoRoot, filePath);
      lines.push(fs.existsSync(absolutePath) ? `?? ${filePath} (${fs.statSync(absolutePath).size} bytes)` : `?? ${filePath}`);
    }
    if (untrackedFiles.length > 20) {
      lines.push(`... ${untrackedFiles.length - 20} more untracked files`);
    }
    segments.push(lines.join("\n"));
  }
  return segments.join("\n\n").slice(0, maxChars);
}

function buildCaptureSnapshot(repoRoot, captureConfig) {
  const excludedPrefixes = Array.isArray(captureConfig.excludePathPrefixes)
    ? captureConfig.excludePathPrefixes
    : DEFAULT_CAPTURE_CONFIG.excludePathPrefixes;
  const maxDiffChars =
    Number.isInteger(captureConfig.maxDiffChars) && captureConfig.maxDiffChars > 0
      ? captureConfig.maxDiffChars
      : DEFAULT_CAPTURE_CONFIG.maxDiffChars;
  return {
    capturedAt: nowIso(),
    worktreeFiles: getWorktreeFiles(repoRoot, excludedPrefixes),
    worktreeDiff: getWorktreeDiff(repoRoot, maxDiffChars, excludedPrefixes),
  };
}

function readTranscriptExcerpt(pathValue, maxChars) {
  return pathValue ? tailText(pathValue, maxChars) : "";
}

function extractJson(text) {
  const rawText = typeof text === "string" ? text.trim() : "";
  if (!rawText) {
    return null;
  }
  const candidates = [rawText];
  const first = rawText.indexOf("{");
  const last = rawText.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last >= first) {
    candidates.push(rawText.slice(first, last + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
  }
  return null;
}

function cleanBullets(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const cleanedItems = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const cleaned = item.trim().replace(/^[-*]\s+/, "").trim();
    const normalized = normalizeText(cleaned);
    if (!cleaned || !normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    cleanedItems.push(cleaned);
  }
  return cleanedItems;
}

function mergeStringLists(...values) {
  const merged = [];
  const seen = new Set();
  for (const value of values) {
    if (!Array.isArray(value)) {
      continue;
    }
    for (const item of value) {
      if (typeof item !== "string") {
        continue;
      }
      const cleaned = item.trim();
      if (!cleaned || seen.has(cleaned)) {
        continue;
      }
      seen.add(cleaned);
      merged.push(cleaned);
    }
  }
  return merged;
}

function extractRulePaths(text) {
  const paths = [];
  for (const match of text.matchAll(FILE_PATH_PATTERN)) {
    const value = (match[1] || "").trim().replace(/^["']|["']$/g, "");
    if (value) {
      paths.push(value);
    }
  }
  return uniqueStrings(paths);
}

function detectRuleTool(text) {
  const normalized = normalizeText(text);
  for (const [toolName, aliases] of RULE_TOOL_PATTERNS) {
    if (aliases.some((alias) => normalized.includes(alias))) {
      return toolName;
    }
  }
  return "";
}

function collectRuleRequirements(text) {
  const normalized = normalizeText(text);
  const requirements = {};
  for (const [key, aliasMap] of Object.entries(RULE_REQUIREMENT_ALIASES)) {
    const matched = [];
    for (const [alias, canonical] of Object.entries(aliasMap)) {
      if (normalized.includes(alias)) {
        matched.push(canonical);
      }
    }
    if (matched.length > 0) {
      requirements[key] = uniqueStrings(matched);
    }
  }
  return requirements;
}

function inferRuleKind(text, collectionName, paths) {
  const normalized = normalizeText(text);
  if (collectionName === "candidateSpec") {
    if (paths.length > 0) {
      return "path-rule";
    }
    if (DEFERRED_SPEC_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      return "workflow";
    }
    return "rule";
  }
  if (paths.length > 0) {
    return "path-fact";
  }
  if (DEFERRED_KNOWLEDGE_HINTS.some((hint) => ` ${normalized} `.includes(hint))) {
    return "repo-fact";
  }
  return "knowledge";
}

function inferRuleScope(paths) {
  return paths.length > 0 ? "path" : "repo";
}

function buildRuleMetadata(text, collectionName) {
  const paths = extractRulePaths(text);
  return {
    collection: collectionName,
    kind: inferRuleKind(text, collectionName, paths),
    scope: inferRuleScope(paths),
    paths,
    tool: detectRuleTool(text),
    requires: collectRuleRequirements(text),
  };
}

function splitDeferredSentences(text) {
  if (!text.trim()) {
    return [];
  }
  const collapsed = text.trim().replace(/\s+/g, " ");
  const parts = collapsed.split(/(?<=[.!?])\s+/);
  const sentences = [];
  for (let cleaned of parts.map((item) => item.trim().replace(/^[-*]\s+/, "").trim())) {
    if (cleaned.length < 24) {
      continue;
    }
    if (cleaned.length > 240) {
      cleaned = `${cleaned.slice(0, 237).trimEnd()}...`;
    }
    sentences.push(cleaned);
  }
  return sentences;
}

function extractDeferredCandidateSpec(textSources) {
  const candidates = [];
  for (const text of textSources) {
    for (const sentence of splitDeferredSentences(text)) {
      const normalized = normalizeText(sentence);
      if (DEFERRED_SPEC_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
        candidates.push(sentence);
      }
    }
  }
  return cleanBullets(candidates).slice(0, 4);
}

function extractDeferredKnowledge(textSources) {
  const candidates = [];
  for (const text of textSources) {
    for (const sentence of splitDeferredSentences(text)) {
      const normalized = ` ${normalizeText(sentence)} `;
      if (DEFERRED_KNOWLEDGE_HINTS.some((hint) => normalized.includes(hint)) && FILE_PATH_PATTERN.test(sentence)) {
        candidates.push(sentence);
      }
    }
  }
  return cleanBullets(candidates).slice(0, 4);
}

function summarizeDeferredContext(assistantExcerpt, transcriptText, files) {
  for (const sourceText of [assistantExcerpt, transcriptText]) {
    for (const sentence of splitDeferredSentences(sourceText)) {
      return `Deferred Memraft summary captured after session end. ${sentence}`;
    }
  }
  let summary = "Deferred Memraft summary captured after session end.";
  if (files.length > 0) {
    summary = `${summary} Files touched: ${files.slice(0, 5).join(", ")}.`;
  }
  return summary;
}

function buildDeferredSummaryPayload(request, transcriptText, files) {
  const assistantExcerpt = getStringValue(request, "assistantMessageExcerpt");
  const sources = [assistantExcerpt, transcriptText];
  return {
    summary: summarizeDeferredContext(assistantExcerpt, transcriptText, files),
    knowledge: extractDeferredKnowledge(sources),
    candidate_spec: extractDeferredCandidateSpec(sources),
  };
}

function fallbackPayload(event, files) {
  let summary = "Session ended without a completed Memraft subagent summary.";
  if (getStringValue(event, "eventKind") === "session_end_fallback") {
    summary = "Session ended before a completed Memraft subagent summary was captured.";
  }
  if (files.length > 0) {
    summary = `${summary} Files touched: ${files.slice(0, 5).join(", ")}.`;
  }
  return {
    summary,
    knowledge: [],
    candidate_spec: [],
  };
}

function scoreQuality(
  transcriptText,
  diffText,
  files,
  generator,
  summary,
  knowledge,
  candidateSpec,
  { manualCapture = false } = {},
) {
  let score = 0;
  const signals = [];
  const transcriptChars = transcriptText.trim().length;
  if (transcriptChars >= 1500) {
    score += 25;
    signals.push("transcript");
  } else if (transcriptChars > 0) {
    score += 12;
    signals.push("transcript");
  }
  const diffChars = diffText.trim().length;
  if (diffChars >= 1000) {
    score += 20;
    signals.push("diff");
  } else if (diffChars > 0) {
    score += 10;
    signals.push("diff");
  }
  if (files.length > 0) {
    score += Math.min(15, 5 + files.length * 2);
    signals.push("files");
  }
  if (generator.endsWith("fallback")) {
    signals.push("fallback");
  } else {
    score += 20;
    signals.push("model_summary");
  }
  if (summary) {
    score += 10;
    signals.push("summary");
  }
  const extractedCount = knowledge.length + candidateSpec.length;
  if (extractedCount > 0) {
    score += Math.min(20, extractedCount * 5);
    signals.push("extracted_items");
  }
  if (manualCapture) {
    score += 20;
    signals.push("manual_capture");
  }
  score = Math.min(score, 100);
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D";
  return {
    grade,
    score,
    signals,
    transcriptChars,
    diffChars,
    fileCount: files.length,
  };
}

function gradeRank(grade) {
  return GRADE_ORDER[grade] ?? 0;
}

function mergeAllowed(quality, config) {
  const merge = config?.merge;
  let minimumGrade = "C";
  if (merge && typeof merge === "object" && typeof merge.minimumGrade === "string" && merge.minimumGrade) {
    minimumGrade = merge.minimumGrade.toUpperCase();
  }
  const grade = typeof quality?.grade === "string" ? quality.grade : "D";
  return [gradeRank(grade) >= gradeRank(minimumGrade), minimumGrade];
}

function calculateConfidence(averageScore, evidenceCount) {
  const boundedScore = Math.max(0, Math.min(averageScore, 100));
  const boundedEvidence = Math.max(0, evidenceCount);
  const qualityComponent = boundedScore / 100;
  const supportComponent = Math.min(boundedEvidence, 4) / 4;
  return Number(Math.min(qualityComponent * 0.65 + supportComponent * 0.35, 1).toFixed(2));
}

function getRecordLifecycleStatus(record) {
  const statusValue = record?.lifecycleStatus;
  if (typeof statusValue === "string" && ["active", "invalidated"].includes(statusValue)) {
    return statusValue;
  }
  return typeof record?.invalidatedAt === "string" && record.invalidatedAt ? "invalidated" : "active";
}

function isRecordInvalidated(record) {
  return getRecordLifecycleStatus(record) === "invalidated";
}

function ensureRuleRecordShape(record, collectionName) {
  let changed = false;
  const text = typeof record?.text === "string" ? record.text : "";
  const metadata = buildRuleMetadata(text, collectionName);
  for (const key of ["collection", "kind", "scope", "tool"]) {
    if (record[key] !== metadata[key]) {
      record[key] = metadata[key];
      changed = true;
    }
  }
  if (stableJsonStringify(record.paths ?? []) !== stableJsonStringify(metadata.paths)) {
    record.paths = metadata.paths;
    changed = true;
  }
  if (stableJsonStringify(record.requires ?? {}) !== stableJsonStringify(metadata.requires)) {
    record.requires = metadata.requires;
    changed = true;
  }
  const sourceEvidenceIds = mergeStringLists(record.sourceEvidenceIds ?? []);
  if (stableJsonStringify(record.sourceEvidenceIds ?? []) !== stableJsonStringify(sourceEvidenceIds)) {
    record.sourceEvidenceIds = sourceEvidenceIds;
    changed = true;
  }
  const lifecycleStatus = getRecordLifecycleStatus(record);
  if (record.lifecycleStatus !== lifecycleStatus) {
    record.lifecycleStatus = lifecycleStatus;
    changed = true;
  }
  for (const [key, value] of Object.entries({
    invalidatedAt: "",
    invalidationReason: "",
    lastValidatedAt: "",
    demotedAt: "",
    restoredAt: "",
  })) {
    if (typeof record[key] !== "string") {
      record[key] = value;
      changed = true;
    }
  }
  return changed;
}

function updatePromotionStatus(record, promotionRules, createdAt) {
  const occurrences = Number.isInteger(record?.occurrences) ? record.occurrences : 0;
  const evidenceCount = Number.isInteger(record?.evidenceCount) ? record.evidenceCount : 0;
  const confidence = typeof record?.confidence === "number" ? record.confidence : 0;
  const qualifies =
    !isRecordInvalidated(record) &&
    occurrences >= (promotionRules.minimumOccurrences ?? 2) &&
    evidenceCount >= (promotionRules.minimumEvidenceCount ?? 2) &&
    confidence >= (promotionRules.minimumConfidence ?? 0.68);
  const previousStatus = typeof record?.promotionStatus === "string" ? record.promotionStatus : "candidate";
  record.promotionStatus = qualifies ? "promoted" : "candidate";
  if (qualifies && (!record.firstPromotedAt || typeof record.firstPromotedAt !== "string")) {
    record.firstPromotedAt = createdAt;
  }
  return previousStatus !== "promoted" && qualifies;
}

function reconcileRuleRecord(record, collectionName, repoRoot, repoProfile, promotionRules, validatedAt) {
  let changed = ensureRuleRecordShape(record, collectionName);
  const reasons = [];
  const paths = Array.isArray(record.paths) ? record.paths.filter((item) => typeof item === "string" && item) : [];
  const missingPaths = paths.filter((item) => !fs.existsSync(path.join(repoRoot, item)));
  if (missingPaths.length > 0) {
    reasons.push(`missing paths: ${missingPaths.slice(0, 3).join(", ")}`);
  }
  const requirements = record.requires;
  if (requirements && typeof requirements === "object" && !Array.isArray(requirements)) {
    const repoArrays = {
      packageManagers: repoProfile.packageManagers ?? [],
      languages: repoProfile.languages ?? [],
      frameworks: repoProfile.frameworks ?? [],
      tooling: repoProfile.tooling ?? [],
    };
    for (const [key, repoValues] of Object.entries(repoArrays)) {
      const requiredValues = Array.isArray(requirements[key]) ? requirements[key] : [];
      if (requiredValues.length === 0) {
        continue;
      }
      const available = new Set(
        Array.isArray(repoValues)
          ? repoValues.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim().toLowerCase())
          : [],
      );
      const missing = requiredValues.filter(
        (item) => typeof item === "string" && item.trim() && !available.has(item.trim().toLowerCase()),
      );
      if (missing.length > 0) {
        reasons.push(`${key} no longer match: ${missing.slice(0, 3).join(", ")}`);
      }
    }
    const requiredWorkspace = Array.isArray(requirements.workspaceTypes) ? requirements.workspaceTypes : [];
    const workspaceType = getStringValue(repoProfile, "workspaceType").toLowerCase();
    const missing = requiredWorkspace.filter(
      (item) => typeof item === "string" && item.trim() && item.trim().toLowerCase() !== workspaceType,
    );
    if (missing.length > 0) {
      reasons.push(`workspace type changed: ${missing.slice(0, 3).join(", ")}`);
    }
  }
  const invalidated = reasons.length > 0;
  const previousLifecycle = getRecordLifecycleStatus(record);
  const previousPromotion = getStringValue(record, "promotionStatus") || "candidate";
  if (invalidated) {
    const reason = reasons.join("; ");
    if (record.lastValidatedAt !== validatedAt) {
      record.lastValidatedAt = validatedAt;
      changed = true;
    }
    if (previousLifecycle !== "invalidated") {
      record.invalidatedAt = validatedAt;
      record.restoredAt = "";
      changed = true;
    }
    if (record.invalidationReason !== reason) {
      record.invalidationReason = reason;
      changed = true;
    }
    if (record.lifecycleStatus !== "invalidated") {
      record.lifecycleStatus = "invalidated";
      changed = true;
    }
    if (previousPromotion === "promoted") {
      record.promotionStatus = "candidate";
      record.demotedAt = validatedAt;
      changed = true;
    }
    return changed;
  }
  if (previousLifecycle === "invalidated") {
    for (const [key, value] of Object.entries({
      lastValidatedAt: validatedAt,
      invalidatedAt: "",
      invalidationReason: "",
      lifecycleStatus: "active",
      restoredAt: validatedAt,
    })) {
      if (record[key] !== value) {
        record[key] = value;
        changed = true;
      }
    }
  }
  if (updatePromotionStatus(record, promotionRules, validatedAt)) {
    if (record.lastValidatedAt !== validatedAt) {
      record.lastValidatedAt = validatedAt;
      changed = true;
    }
    changed = true;
  } else if (record.promotionStatus !== previousPromotion) {
    if (record.lastValidatedAt !== validatedAt) {
      record.lastValidatedAt = validatedAt;
      changed = true;
    }
    changed = true;
  }
  return changed;
}

function coerceRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function rankRecords(records) {
  const values = Object.values(records ?? {}).filter((value) => coerceRecord(value) !== null);
  return values.sort((left, right) => {
    const leftConfidence = typeof left.confidence === "number" ? Math.round(left.confidence * 100) : 0;
    const rightConfidence = typeof right.confidence === "number" ? Math.round(right.confidence * 100) : 0;
    const leftScore = Number.isInteger(left.bestScore) ? left.bestScore : 0;
    const rightScore = Number.isInteger(right.bestScore) ? right.bestScore : 0;
    const leftOccurrences = Number.isInteger(left.occurrences) ? left.occurrences : 0;
    const rightOccurrences = Number.isInteger(right.occurrences) ? right.occurrences : 0;
    const leftSeen = Number(String(left.lastSeenAt ?? "").replace(/\D/g, "") || 0);
    const rightSeen = Number(String(right.lastSeenAt ?? "").replace(/\D/g, "") || 0);
    const leftText = typeof left.text === "string" ? left.text.toLowerCase() : "";
    const rightText = typeof right.text === "string" ? right.text.toLowerCase() : "";
    return (
      rightConfidence - leftConfidence ||
      rightScore - leftScore ||
      rightOccurrences - leftOccurrences ||
      rightSeen - leftSeen ||
      leftText.localeCompare(rightText)
    );
  });
}

function partitionRankedRecords(records) {
  const promotedRecords = [];
  const candidateRecords = [];
  const invalidatedRecords = [];
  for (const record of rankRecords(records)) {
    if (isRecordInvalidated(record)) {
      invalidatedRecords.push(record);
      continue;
    }
    const status = typeof record.promotionStatus === "string" ? record.promotionStatus : "candidate";
    if (status === "promoted") {
      promotedRecords.push(record);
    } else {
      candidateRecords.push(record);
    }
  }
  return [promotedRecords, candidateRecords, invalidatedRecords];
}

function summarizeRecordGroups(records) {
  const [promotedRecords, candidateRecords, invalidatedRecords] = partitionRankedRecords(records);
  const kindCounts = {};
  const scopeCounts = {};
  for (const record of rankRecords(records)) {
    const kind = getStringValue(record, "kind") || "unknown";
    const scope = getStringValue(record, "scope") || "repo";
    kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;
    scopeCounts[scope] = (scopeCounts[scope] ?? 0) + 1;
  }
  return {
    promotedCount: promotedRecords.length,
    candidateCount: candidateRecords.length,
    invalidatedCount: invalidatedRecords.length,
    activeCount: promotedRecords.length + candidateRecords.length,
    kindCounts,
    scopeCounts,
  };
}

function formatRecordLine(record, { includeMeta }) {
  const text = typeof record.text === "string" ? record.text : "";
  if (!includeMeta) {
    return `- ${text}`;
  }
  const grade = typeof record.bestGrade === "string" ? record.bestGrade : "D";
  const score = Number.isInteger(record.bestScore) ? record.bestScore : 0;
  const occurrences = Number.isInteger(record.occurrences) ? record.occurrences : 0;
  const confidence = typeof record.confidence === "number" ? record.confidence : 0;
  const kind = getStringValue(record, "kind") || "rule";
  const scope = getStringValue(record, "scope") || "repo";
  return `- [${grade}|${score}|x${occurrences}|c${confidence.toFixed(2)}|${kind}|${scope}] ${text}`;
}

function renderProfileLines(repoProfile, { compactCommands }) {
  const lines = [];
  if (getStringValue(repoProfile, "projectName")) {
    lines.push(`- Project: ${repoProfile.projectName}`);
  }
  if (getStringValue(repoProfile, "workspaceType")) {
    lines.push(`- Workspace: ${repoProfile.workspaceType}`);
  }
  if (Array.isArray(repoProfile.languages) && repoProfile.languages.length > 0) {
    lines.push(`- Languages: ${repoProfile.languages.slice(0, 4).join(", ")}`);
  }
  if (Array.isArray(repoProfile.packageManagers) && repoProfile.packageManagers.length > 0) {
    lines.push(`- Package managers: ${repoProfile.packageManagers.slice(0, 3).join(", ")}`);
  }
  if (Array.isArray(repoProfile.frameworks) && repoProfile.frameworks.length > 0) {
    lines.push(`- Frameworks: ${repoProfile.frameworks.slice(0, 4).join(", ")}`);
  }
  if (Array.isArray(repoProfile.tooling) && repoProfile.tooling.length > 0) {
    lines.push(`- Tooling: ${repoProfile.tooling.slice(0, 5).join(", ")}`);
  }
  if (repoProfile.commands && typeof repoProfile.commands === "object" && !Array.isArray(repoProfile.commands)) {
    for (const key of ["install", "dev", "build", "test", "lint", "typecheck"]) {
      const value = repoProfile.commands[key];
      if (typeof value !== "string" || !value.trim()) {
        continue;
      }
      const rendered = compactCommands && value.trim().length > 88 ? `${value.trim().slice(0, 85).trimEnd()}...` : value.trim();
      lines.push(`- ${key}: ${rendered}`);
    }
  }
  return lines.length > 0 ? lines : ["- Repo profile has not been scanned yet."];
}

function renderPromotedLines(records, { includeMeta, limit, emptyMessage }) {
  const [promotedRecords] = partitionRankedRecords(records);
  if (promotedRecords.length === 0) {
    return [emptyMessage];
  }
  return promotedRecords.slice(0, limit).map((record) => formatRecordLine(record, { includeMeta }));
}

function renderRecentEvidenceLines(latestEvidence, { includeFiles, maxFiles }) {
  const lines = [];
  const summary = getStringValue(latestEvidence, "summary");
  const grade = latestEvidence?.quality && typeof latestEvidence.quality === "object" ? getStringValue(latestEvidence.quality, "grade") : "";
  if (summary) {
    lines.push(summary);
  }
  if (grade) {
    lines.push(`Quality grade: ${grade}`);
  }
  if (includeFiles && Array.isArray(latestEvidence?.files)) {
    const fileLines = latestEvidence.files
      .slice(0, maxFiles)
      .filter((item) => typeof item === "string" && item)
      .map((item) => `- ${item}`);
    if (fileLines.length > 0) {
      lines.push("Files touched:", ...fileLines);
    }
  }
  return lines;
}

function renderManualCaptureProtocolLines() {
  return [
    "## Session Capture Protocol",
    "",
    "When you finish substantive work or discover a durable project rule, write a strict JSON capture back into the local Memraft runtime.",
    "",
    "```bash",
    "node .memraft/hooks/manual_capture.mjs --tool <codex|gemini-cli|opencode|claude-code> <<'EOF'",
    '{"summary":"1-3 sentence summary","knowledge":["stable repo fact"],"candidate_spec":["reusable convention or contract"]}',
    "EOF",
    "```",
    "",
    "- Replace `<...>` with the current CLI.",
    "- Keep `knowledge` for stable repo facts, architecture notes, and project background.",
    "- Keep `candidate_spec` for reusable workflows, conventions, contracts, or path-scoped rules.",
    "- Skip one-off trivia.",
    "- Run this before ending the session when the work produced reusable knowledge.",
  ];
}

function getDbPath(repoRoot) {
  return path.join(repoRoot, MEMRAFT_DIR, "state", "index.sqlite");
}

function connect(repoRoot) {
  const dbPath = getDbPath(repoRoot);
  ensureDir(path.dirname(dbPath));
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  return db;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      event_kind TEXT,
      created_at TEXT,
      session_id TEXT,
      reason TEXT,
      generator TEXT,
      quality_grade TEXT,
      quality_score INTEGER,
      summary TEXT,
      transcript_text TEXT,
      diff_text TEXT,
      files_json TEXT NOT NULL,
      knowledge_json TEXT NOT NULL,
      candidate_spec_json TEXT NOT NULL,
      source_json TEXT NOT NULL,
      event_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_chunks (
      chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
      chunk_type TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS event_chunks_fts USING fts5(text, event_id UNINDEXED, chunk_type UNINDEXED);
    CREATE TABLE IF NOT EXISTS memories (
      memory_id TEXT PRIMARY KEY,
      collection_name TEXT NOT NULL,
      task_id TEXT,
      scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      promotion_status TEXT NOT NULL,
      lifecycle_status TEXT NOT NULL,
      text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(text, memory_id UNINDEXED, collection_name UNINDEXED, task_id UNINDEXED);
    CREATE TABLE IF NOT EXISTS memory_edges (
      edge_id TEXT PRIMARY KEY,
      from_memory_id TEXT NOT NULL,
      to_memory_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      details_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      notes_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS adapter_state (
      adapter_name TEXT PRIMARY KEY,
      ownership TEXT NOT NULL,
      details_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function getMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return typeof row?.value === "string" ? row.value : "";
}

function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO meta(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function rebuildMemoryFts(db) {
  db.exec("DELETE FROM memory_fts");
  const rows = db.prepare("SELECT rowid, memory_id, collection_name, task_id, text FROM memories").all();
  const stmt = db.prepare(`
    INSERT INTO memory_fts(rowid, text, memory_id, collection_name, task_id)
    VALUES(?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    stmt.run(row.rowid, row.text, row.memory_id, row.collection_name, row.task_id || "");
  }
}

function upsertMemoryFtsRow(db, rowid, text, memoryId, collectionName, taskId) {
  db.prepare("DELETE FROM memory_fts WHERE rowid = ?").run(rowid);
  db.prepare(`
    INSERT INTO memory_fts(rowid, text, memory_id, collection_name, task_id)
    VALUES(?, ?, ?, ?, ?)
  `).run(rowid, text, memoryId, collectionName, taskId);
}

function rebuildEventChunksFts(db) {
  db.exec("DELETE FROM event_chunks_fts");
  const rows = db.prepare("SELECT chunk_id, text, event_id, chunk_type FROM event_chunks").all();
  const stmt = db.prepare(`
    INSERT INTO event_chunks_fts(rowid, text, event_id, chunk_type)
    VALUES(?, ?, ?, ?)
  `);
  for (const row of rows) {
    stmt.run(row.chunk_id, row.text, row.event_id, row.chunk_type);
  }
}

function insertEventChunk(db, eventId, chunkType, text) {
  const result = db.prepare("INSERT INTO event_chunks(event_id, chunk_type, text) VALUES(?, ?, ?)").run(eventId, chunkType, text);
  db.prepare(`
    INSERT INTO event_chunks_fts(rowid, text, event_id, chunk_type)
    VALUES(?, ?, ?, ?)
  `).run(Number(result.lastInsertRowid), text, eventId, chunkType);
}

function buildMemoryId(collectionName, fingerprint, taskId = "") {
  return taskId ? `${collectionName}:${taskId}:${fingerprint}` : `${collectionName}:${fingerprint}`;
}

function upsertMemoryRow(db, collectionName, fingerprint, record, { taskId = "" } = {}) {
  const memoryId = buildMemoryId(collectionName, fingerprint, taskId);
  const updatedAt = String(record.lastSeenAt || record.updatedAt || "");
  const scope = typeof record.scope === "string" && record.scope ? record.scope : "repo";
  const kind = typeof record.kind === "string" && record.kind ? record.kind : "knowledge";
  const promotionStatus =
    typeof record.promotionStatus === "string" && record.promotionStatus ? record.promotionStatus : "candidate";
  const lifecycleStatus =
    typeof record.lifecycleStatus === "string" && record.lifecycleStatus ? record.lifecycleStatus : "active";
  const text = typeof record.text === "string" ? record.text : "";
  db.prepare(`
    INSERT INTO memories(
      memory_id, collection_name, task_id, scope, kind,
      promotion_status, lifecycle_status, text, normalized_text,
      updated_at, record_json
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      scope = excluded.scope,
      kind = excluded.kind,
      promotion_status = excluded.promotion_status,
      lifecycle_status = excluded.lifecycle_status,
      text = excluded.text,
      normalized_text = excluded.normalized_text,
      updated_at = excluded.updated_at,
      record_json = excluded.record_json
  `).run(
    memoryId,
    collectionName,
    taskId,
    scope,
    kind,
    promotionStatus,
    lifecycleStatus,
    text,
    normalizeText(text),
    updatedAt,
    jsonDumps(record),
  );
  const row = db.prepare("SELECT rowid FROM memories WHERE memory_id = ?").get(memoryId);
  if (row) {
    upsertMemoryFtsRow(db, row.rowid, text, memoryId, collectionName, taskId);
  }
}

function eventChunksFromMaterial(evidence, transcriptText, diffText) {
  const chunks = [];
  if (typeof evidence.summary === "string" && evidence.summary.trim()) {
    chunks.push(["summary", evidence.summary.trim()]);
  }
  for (const item of evidence.knowledge ?? []) {
    if (typeof item === "string" && item.trim()) {
      chunks.push(["knowledge", item.trim()]);
    }
  }
  for (const item of evidence.candidateSpec ?? []) {
    if (typeof item === "string" && item.trim()) {
      chunks.push(["candidate_spec", item.trim()]);
    }
  }
  if (Array.isArray(evidence.files) && evidence.files.length > 0) {
    const rendered = evidence.files.filter((item) => typeof item === "string" && item.trim()).join("\n").trim();
    if (rendered) {
      chunks.push(["files", rendered]);
    }
  }
  for (const [chunkType, text] of [
    ["transcript", transcriptText.trim()],
    ["diff", diffText.trim()],
  ]) {
    if (text) {
      chunks.push([chunkType, text.slice(0, 5000)]);
    }
  }
  return chunks;
}

function importLegacyEvents(db, repoRoot) {
  const sessionsDir = path.join(repoRoot, MEMRAFT_DIR, "evidence", "sessions");
  if (!fs.existsSync(sessionsDir)) {
    return;
  }
  for (const filename of fs.readdirSync(sessionsDir).filter((name) => name.endsWith(".json")).sort()) {
    const payload = readJson(path.join(sessionsDir, filename));
    if (!payload || typeof payload !== "object") {
      continue;
    }
    const eventId = typeof payload.eventId === "string" ? payload.eventId : "";
    if (!eventId) {
      continue;
    }
    if (db.prepare("SELECT 1 FROM events WHERE event_id = ?").get(eventId)) {
      continue;
    }
    const source = payload.source && typeof payload.source === "object" ? payload.source : {};
    const transcriptText = typeof source.transcriptExcerpt === "string" ? source.transcriptExcerpt : "";
    const diffText = typeof source.diffExcerpt === "string" ? source.diffExcerpt : "";
    db.prepare(`
      INSERT INTO events(
        event_id, event_kind, created_at, session_id, reason, generator,
        quality_grade, quality_score, summary, transcript_text, diff_text,
        files_json, knowledge_json, candidate_spec_json, source_json,
        event_json, payload_json, evidence_json
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      payload.eventKind,
      payload.createdAt,
      payload.sessionId,
      payload.reason,
      payload.generator,
      payload.quality && typeof payload.quality === "object" ? payload.quality.grade : "",
      payload.quality && typeof payload.quality === "object" ? payload.quality.score : 0,
      payload.summary,
      transcriptText,
      diffText,
      jsonDumps(payload.files ?? []),
      jsonDumps(payload.knowledge ?? []),
      jsonDumps(payload.candidateSpec ?? []),
      jsonDumps(payload.source ?? {}),
      jsonDumps({}),
      jsonDumps({}),
      jsonDumps(payload),
    );
    for (const [chunkType, text] of eventChunksFromMaterial(payload, transcriptText, diffText)) {
      db.prepare("INSERT INTO event_chunks(event_id, chunk_type, text) VALUES(?, ?, ?)").run(eventId, chunkType, text);
    }
  }
}

function importLegacyMergeIndex(db, repoRoot) {
  const mergeIndex = readJson(path.join(repoRoot, MEMRAFT_DIR, "state", "merge-index.json"));
  if (!mergeIndex || typeof mergeIndex !== "object") {
    return;
  }
  for (const collectionName of ["knowledge", "candidateSpec"]) {
    const records = mergeIndex[collectionName];
    if (!records || typeof records !== "object" || Array.isArray(records)) {
      continue;
    }
    for (const [fingerprint, value] of Object.entries(records)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        upsertMemoryRow(db, collectionName, fingerprint, value);
      }
    }
  }
}

function ensureStorage(repoRoot) {
  const db = connect(repoRoot);
  try {
    ensureSchema(db);
    const currentVersion = getMeta(db, "schema_version");
    if (currentVersion !== String(SCHEMA_VERSION)) {
      setMeta(db, "schema_version", String(SCHEMA_VERSION));
    }
    if (getMeta(db, "legacy_import_completed") === "1") {
      return;
    }
    const hasEvents = Boolean(db.prepare("SELECT 1 FROM events LIMIT 1").get());
    const hasMemories = Boolean(db.prepare("SELECT 1 FROM memories LIMIT 1").get());
    if (!hasEvents) {
      importLegacyEvents(db, repoRoot);
    }
    if (!hasMemories) {
      importLegacyMergeIndex(db, repoRoot);
    }
    rebuildEventChunksFts(db);
    rebuildMemoryFts(db);
    setMeta(db, "legacy_import_completed", "1");
  } finally {
    db.close();
  }
}

function writeAuditEntry(repoRoot, createdAt, actionType, entityType, entityId, details) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    db.prepare(`
      INSERT INTO audit_log(created_at, action_type, entity_type, entity_id, details_json)
      VALUES(?, ?, ?, ?, ?)
    `).run(createdAt, actionType, entityType, entityId, jsonDumps(details));
  } finally {
    db.close();
  }
}

function setAdapterState(repoRoot, adapterName, ownership, details, updatedAt) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    db.prepare(`
      INSERT INTO adapter_state(adapter_name, ownership, details_json, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(adapter_name) DO UPDATE SET
        ownership = excluded.ownership,
        details_json = excluded.details_json,
        updated_at = excluded.updated_at
    `).run(adapterName, ownership, jsonDumps(details), updatedAt);
  } finally {
    db.close();
  }
}

function addMemoryEdge(repoRoot, fromMemoryId, toMemoryId, relationType, createdAt, details, { dedupeKey = "" } = {}) {
  ensureStorage(repoRoot);
  const edgeId = fingerprintText(dedupeKey || `${fromMemoryId}|${toMemoryId}|${relationType}|${createdAt}`);
  const db = connect(repoRoot);
  try {
    db.prepare(`
      INSERT INTO memory_edges(edge_id, from_memory_id, to_memory_id, relation_type, created_at, details_json)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(edge_id) DO NOTHING
    `).run(edgeId, fromMemoryId, toMemoryId, relationType, createdAt, jsonDumps(details));
  } finally {
    db.close();
  }
}

function getMemoryEdges(repoRoot, memoryId = "") {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const rows = memoryId
      ? db
          .prepare(`
            SELECT edge_id, from_memory_id, to_memory_id, relation_type, created_at, details_json
            FROM memory_edges
            WHERE from_memory_id = ? OR to_memory_id = ?
            ORDER BY created_at DESC, edge_id DESC
          `)
          .all(memoryId, memoryId)
      : db
          .prepare(`
            SELECT edge_id, from_memory_id, to_memory_id, relation_type, created_at, details_json
            FROM memory_edges
            ORDER BY created_at DESC, edge_id DESC
          `)
          .all();
    return rows.map((row) => ({
      edgeId: row.edge_id,
      fromMemoryId: row.from_memory_id,
      toMemoryId: row.to_memory_id,
      relationType: row.relation_type,
      createdAt: row.created_at,
      details: jsonLoads(row.details_json, {}),
    }));
  } finally {
    db.close();
  }
}

function deleteAutoMemoryEdges(repoRoot) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const rows = db.prepare("SELECT edge_id, details_json FROM memory_edges").all();
    const deleteIds = rows
      .filter((row) => {
        const details = jsonLoads(row.details_json, {});
        return details && typeof details === "object" && details.source === "auto-relation";
      })
      .map((row) => row.edge_id);
    if (deleteIds.length > 0) {
      const placeholders = deleteIds.map(() => "?").join(", ");
      db.prepare(`DELETE FROM memory_edges WHERE edge_id IN (${placeholders})`).run(...deleteIds);
    }
  } finally {
    db.close();
  }
}

function sharedPaths(left, right) {
  const leftSet = new Set(Array.isArray(left.paths) ? left.paths.filter((item) => typeof item === "string" && item) : []);
  const rightSet = new Set(Array.isArray(right.paths) ? right.paths.filter((item) => typeof item === "string" && item) : []);
  return [...leftSet].filter((item) => rightSet.has(item)).sort();
}

function hasNegation(text) {
  const normalized = ` ${normalizeText(text)} `;
  return [" do not ", " don't ", " should not ", " must not ", " never ", " avoid "].some((token) =>
    normalized.includes(token),
  );
}

function normalizeRelationText(text) {
  return normalizeText(text)
    .replace(/([,;:!?])(?=\s|$)/g, " ")
    .replace(/(?<!\.)\.(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalMemoryPair(leftMemoryId, rightMemoryId) {
  return [leftMemoryId, rightMemoryId].sort();
}

function semanticPairForExtends(left, right) {
  const leftText = String(left.record.text ?? "");
  const rightText = String(right.record.text ?? "");
  if (leftText.length < rightText.length) {
    return [left.memoryId, right.memoryId];
  }
  if (rightText.length < leftText.length) {
    return [right.memoryId, left.memoryId];
  }
  return canonicalMemoryPair(left.memoryId, right.memoryId);
}

function semanticPairForUpdates(left, right) {
  const leftSeen = String(left.record.lastSeenAt ?? "");
  const rightSeen = String(right.record.lastSeenAt ?? "");
  if (leftSeen < rightSeen) {
    return [left.memoryId, right.memoryId];
  }
  if (rightSeen < leftSeen) {
    return [right.memoryId, left.memoryId];
  }
  return canonicalMemoryPair(left.memoryId, right.memoryId);
}

function modalStrength(text) {
  const normalized = ` ${normalizeRelationText(text)} `;
  let strength = -1;
  for (const [token, value] of MODAL_STRENGTH.entries()) {
    if (normalized.includes(` ${token} `)) {
      strength = Math.max(strength, value);
    }
  }
  return strength;
}

function stripModalTokens(text) {
  let stripped = normalizeRelationText(text);
  for (const token of [...MODAL_STRENGTH.keys()].sort((left, right) => right.length - left.length)) {
    stripped = stripped.replace(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  }
  return stripped.replace(/\s+/g, " ").trim();
}

function recordSupersedes(leftRecord, rightRecord) {
  const rightFingerprint = String(rightRecord.fingerprint ?? "");
  const rightText = normalizeText(String(rightRecord.text ?? ""));
  for (const key of ["supersedes", "supersedesFingerprints", "supersedesTexts"]) {
    const value = leftRecord[key];
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate.trim()) {
        continue;
      }
      const normalized = normalizeText(candidate);
      if (normalized === rightFingerprint || normalized === rightText) {
        return true;
      }
    }
  }
  return false;
}

function semanticPairForSupersedes(left, right) {
  if (recordSupersedes(left.record, right.record)) {
    return [right.memoryId, left.memoryId];
  }
  if (recordSupersedes(right.record, left.record)) {
    return [left.memoryId, right.memoryId];
  }
  const leftStrength = modalStrength(String(left.record.text ?? ""));
  const rightStrength = modalStrength(String(right.record.text ?? ""));
  if (leftStrength < rightStrength) {
    return [left.memoryId, right.memoryId];
  }
  if (rightStrength < leftStrength) {
    return [right.memoryId, left.memoryId];
  }
  return semanticPairForUpdates(left, right);
}

function detectRelationType(leftRecord, rightRecord) {
  const leftText = String(leftRecord.text ?? "");
  const rightText = String(rightRecord.text ?? "");
  if (!leftText || !rightText || leftText === rightText) {
    return "";
  }
  const leftNorm = normalizeRelationText(leftText);
  const rightNorm = normalizeRelationText(rightText);
  if (!leftNorm || !rightNorm || leftNorm === rightNorm) {
    return "";
  }
  const nextSharedPaths = sharedPaths(leftRecord, rightRecord);
  const sameScope = leftRecord.scope === rightRecord.scope;
  const sameKind = leftRecord.kind === rightRecord.kind;
  if (nextSharedPaths.length > 0 && hasNegation(leftText) !== hasNegation(rightText)) {
    return "contradicts";
  }
  if (recordSupersedes(leftRecord, rightRecord) || recordSupersedes(rightRecord, leftRecord)) {
    return "supersedes";
  }
  const leftBase = stripModalTokens(leftText);
  const rightBase = stripModalTokens(rightText);
  if (
    nextSharedPaths.length > 0 &&
    sameScope &&
    sameKind &&
    leftBase &&
    leftBase === rightBase &&
    leftNorm !== rightNorm
  ) {
    return "supersedes";
  }
  if (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm)) {
    return "extends";
  }
  if (nextSharedPaths.length > 0 && sameKind) {
    return "updates";
  }
  if (nextSharedPaths.length > 0 || sameScope) {
    return "references_path";
  }
  return "";
}

function refreshMemoryRelations(repoRoot) {
  ensureStorage(repoRoot);
  deleteAutoMemoryEdges(repoRoot);
  const db = connect(repoRoot);
  let rows;
  try {
    rows = db
      .prepare(`
        SELECT memory_id, collection_name, task_id, scope, kind, record_json
        FROM memories
        ORDER BY updated_at DESC, memory_id ASC
      `)
      .all();
  } finally {
    db.close();
  }
  const records = [];
  for (const row of rows) {
    const record = jsonLoads(row.record_json, {});
    if (!record || typeof record !== "object" || isRecordInvalidated(record)) {
      continue;
    }
    records.push({
      memoryId: row.memory_id,
      collection: row.collection_name,
      taskId: row.task_id || "",
      record,
    });
  }
  for (let index = 0; index < records.length; index += 1) {
    const left = records[index];
    for (const right of records.slice(index + 1)) {
      const relationType = detectRelationType(left.record, right.record);
      if (!relationType) {
        continue;
      }
      const [fromMemoryId, toMemoryId] = canonicalMemoryPair(left.memoryId, right.memoryId);
      const relationDetails = {
        source: "auto-relation",
        sharedPaths: sharedPaths(left.record, right.record),
        leftText: left.record.text ?? "",
        rightText: right.record.text ?? "",
      };
      if (relationType === "extends") {
        const [shorterMemoryId, longerMemoryId] = semanticPairForExtends(left, right);
        relationDetails.shorterMemoryId = shorterMemoryId;
        relationDetails.longerMemoryId = longerMemoryId;
      } else if (relationType === "updates") {
        const [olderMemoryId, newerMemoryId] = semanticPairForUpdates(left, right);
        relationDetails.olderMemoryId = olderMemoryId;
        relationDetails.newerMemoryId = newerMemoryId;
      } else if (relationType === "supersedes") {
        const [supersededMemoryId, supersedingMemoryId] = semanticPairForSupersedes(left, right);
        relationDetails.supersededMemoryId = supersededMemoryId;
        relationDetails.supersedingMemoryId = supersedingMemoryId;
      }
      addMemoryEdge(
        repoRoot,
        fromMemoryId,
        toMemoryId,
        relationType,
        String([left.record.lastSeenAt ?? "", right.record.lastSeenAt ?? ""].sort().at(-1) ?? ""),
        relationDetails,
        { dedupeKey: `auto|${fromMemoryId}|${toMemoryId}|${relationType}` },
      );
    }
  }
}

function getAdapterStates(repoRoot) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const rows = db
      .prepare(`
        SELECT adapter_name, ownership, details_json, updated_at
        FROM adapter_state
        ORDER BY adapter_name ASC
      `)
      .all();
    return Object.fromEntries(
      rows.map((row) => [
        row.adapter_name,
        {
          ownership: row.ownership,
          updatedAt: row.updated_at,
          details: jsonLoads(row.details_json, {}),
        },
      ]),
    );
  } finally {
    db.close();
  }
}

function buildAdapterModesFromStates(states) {
  const isManaged = (name) => states?.[name] && typeof states[name] === "object" && states[name].ownership === "managed";
  const buildMode = (injectEnabled, captureEnabled) => ({
    mode: injectEnabled && captureEnabled ? "full" : injectEnabled ? "inject-only" : captureEnabled ? "capture-only" : "passive",
    injectEnabled,
    captureEnabled,
  });
  return {
    codex: buildMode(isManaged("nativeAgents"), isManaged("nativeCodexConfig")),
    opencode: buildMode(
      isManaged("nativeAgents") && isManaged("nativeOpencodeConfig"),
      isManaged("nativeOpencodeConfig") && isManaged("nativeOpencodePlugin"),
    ),
    gemini: buildMode(isManaged("nativeGemini"), false),
  };
}

function getAdapterModes(repoRoot) {
  return buildAdapterModesFromStates(getAdapterStates(repoRoot));
}

function isCaptureEnabled(repoRoot, toolName) {
  const mode = getAdapterModes(repoRoot)?.[toolName];
  return mode && typeof mode === "object" ? Boolean(mode.captureEnabled) : false;
}

function storeEvent(repoRoot, event, payload, evidence, { transcriptText, diffText }) {
  ensureStorage(repoRoot);
  const eventId = String(evidence.eventId ?? "");
  if (!eventId) {
    return;
  }
  const db = connect(repoRoot);
  try {
    db.prepare(`
      INSERT INTO events(
        event_id, event_kind, created_at, session_id, reason, generator,
        quality_grade, quality_score, summary, transcript_text, diff_text,
        files_json, knowledge_json, candidate_spec_json, source_json,
        event_json, payload_json, evidence_json
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        event_kind = excluded.event_kind,
        created_at = excluded.created_at,
        session_id = excluded.session_id,
        reason = excluded.reason,
        generator = excluded.generator,
        quality_grade = excluded.quality_grade,
        quality_score = excluded.quality_score,
        summary = excluded.summary,
        transcript_text = excluded.transcript_text,
        diff_text = excluded.diff_text,
        files_json = excluded.files_json,
        knowledge_json = excluded.knowledge_json,
        candidate_spec_json = excluded.candidate_spec_json,
        source_json = excluded.source_json,
        event_json = excluded.event_json,
        payload_json = excluded.payload_json,
        evidence_json = excluded.evidence_json
    `).run(
      eventId,
      event.eventKind,
      event.createdAt,
      event.sessionId,
      event.reason,
      evidence.generator,
      evidence.quality && typeof evidence.quality === "object" ? evidence.quality.grade : "",
      evidence.quality && typeof evidence.quality === "object" ? evidence.quality.score : 0,
      evidence.summary,
      transcriptText,
      diffText,
      jsonDumps(evidence.files ?? []),
      jsonDumps(evidence.knowledge ?? []),
      jsonDumps(evidence.candidateSpec ?? []),
      jsonDumps(evidence.source ?? {}),
      jsonDumps(event),
      jsonDumps(payload),
      jsonDumps(evidence),
    );
    const staleChunks = db.prepare("SELECT chunk_id FROM event_chunks WHERE event_id = ?").all(eventId);
    if (staleChunks.length > 0) {
      const chunkIds = staleChunks.map((row) => row.chunk_id);
      const placeholders = chunkIds.map(() => "?").join(", ");
      db.prepare(`DELETE FROM event_chunks_fts WHERE rowid IN (${placeholders})`).run(...chunkIds);
    }
    db.prepare("DELETE FROM event_chunks WHERE event_id = ?").run(eventId);
    for (const [chunkType, text] of eventChunksFromMaterial(evidence, transcriptText, diffText)) {
      insertEventChunk(db, eventId, chunkType, text);
    }
  } finally {
    db.close();
  }
}

function loadEvent(repoRoot, eventId) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const row = db.prepare("SELECT evidence_json FROM events WHERE event_id = ?").get(eventId);
    if (!row) {
      return null;
    }
    const payload = jsonLoads(row.evidence_json, {});
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } finally {
    db.close();
  }
}

function loadLatestEvidenceDb(repoRoot) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const row = db.prepare("SELECT evidence_json FROM events ORDER BY created_at DESC, event_id DESC LIMIT 1").get();
    if (!row) {
      return {};
    }
    const payload = jsonLoads(row.evidence_json, {});
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } finally {
    db.close();
  }
}

function loadMergeIndexDb(repoRoot) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const rows = db
      .prepare(`
        SELECT memory_id, collection_name, record_json
        FROM memories
        WHERE collection_name IN ('knowledge', 'candidateSpec')
        ORDER BY memory_id
      `)
      .all();
    const result = { knowledge: {}, candidateSpec: {} };
    for (const row of rows) {
      const record = jsonLoads(row.record_json, {});
      if (!record || typeof record !== "object") {
        continue;
      }
      let fingerprint = typeof record.fingerprint === "string" && record.fingerprint ? record.fingerprint : "";
      if (!fingerprint) {
        const prefix = `${row.collection_name}:`;
        fingerprint = String(row.memory_id).startsWith(prefix) ? String(row.memory_id).slice(prefix.length) : String(row.memory_id);
        record.fingerprint = fingerprint;
      }
      result[row.collection_name][fingerprint] = record;
    }
    return result;
  } finally {
    db.close();
  }
}

function saveMergeIndexDb(repoRoot, mergeIndex) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const retainedIds = new Set();
    for (const collectionName of ["knowledge", "candidateSpec"]) {
      const records = mergeIndex?.[collectionName];
      if (!records || typeof records !== "object" || Array.isArray(records)) {
        continue;
      }
      for (const [fingerprint, value] of Object.entries(records)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          upsertMemoryRow(db, collectionName, fingerprint, value);
          retainedIds.add(buildMemoryId(collectionName, fingerprint));
        }
      }
    }
    const rows = db
      .prepare(`
        SELECT memory_id FROM memories
        WHERE collection_name IN ('knowledge', 'candidateSpec')
      `)
      .all();
    for (const row of rows) {
      if (retainedIds.has(row.memory_id)) {
        continue;
      }
      const rowid = db.prepare("SELECT rowid FROM memories WHERE memory_id = ?").get(row.memory_id);
      if (rowid) {
        db.prepare("DELETE FROM memory_fts WHERE rowid = ?").run(rowid.rowid);
      }
      db.prepare("DELETE FROM memories WHERE memory_id = ?").run(row.memory_id);
    }
  } finally {
    db.close();
  }
  refreshMemoryRelations(repoRoot);
}

function getActiveTask(repoRoot) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const row = db
      .prepare(`
        SELECT task_id, slug, title, status, is_active, created_at, updated_at, finished_at
        FROM tasks
        WHERE is_active = 1
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `)
      .get();
    if (!row) {
      return null;
    }
    return {
      ...row,
      taskId: row.task_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
      isActive: Boolean(row.is_active),
    };
  } finally {
    db.close();
  }
}

function createTask(repoRoot, title, slug, createdAt) {
  ensureStorage(repoRoot);
  const taskSlug = slug.trim() || slugify(title, "task");
  const taskId = taskSlug;
  const task = {
    taskId,
    slug: taskSlug,
    title: title.trim() || taskSlug,
    status: "idle",
    isActive: false,
    createdAt,
    updatedAt: createdAt,
    finishedAt: "",
  };
  const db = connect(repoRoot);
  try {
    db.prepare(`
      INSERT INTO tasks(task_id, slug, title, status, is_active, created_at, updated_at, finished_at, notes_json)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        slug = excluded.slug,
        title = excluded.title,
        updated_at = excluded.updated_at
    `).run(taskId, taskSlug, task.title, "idle", 0, createdAt, createdAt, "", jsonDumps({}));
  } finally {
    db.close();
  }
  return task;
}

function startTask(repoRoot, taskId, updatedAt) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const row = db
      .prepare(`
        SELECT task_id FROM tasks
        WHERE task_id = ? OR slug = ?
        LIMIT 1
      `)
      .get(taskId, taskId);
    if (!row) {
      return null;
    }
    db.prepare("UPDATE tasks SET is_active = 0 WHERE is_active = 1").run();
    db.prepare(`
      UPDATE tasks
      SET is_active = 1, status = 'active', updated_at = ?, finished_at = ''
      WHERE task_id = ?
    `).run(updatedAt, row.task_id);
  } finally {
    db.close();
  }
  return getActiveTask(repoRoot);
}

function finishTask(repoRoot, taskId, updatedAt) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const row = db
      .prepare(`
        SELECT task_id FROM tasks
        WHERE task_id = ? OR slug = ?
        LIMIT 1
      `)
      .get(taskId, taskId);
    if (!row) {
      return null;
    }
    db.prepare(`
      UPDATE tasks
      SET is_active = 0, status = 'finished', updated_at = ?, finished_at = ?
      WHERE task_id = ?
    `).run(updatedAt, updatedAt, row.task_id);
  } finally {
    db.close();
  }
  return showTask(repoRoot, taskId);
}

function showTask(repoRoot, taskId) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const row = db
      .prepare(`
        SELECT task_id, slug, title, status, is_active, created_at, updated_at, finished_at
        FROM tasks
        WHERE task_id = ? OR slug = ?
        LIMIT 1
      `)
      .get(taskId, taskId);
    if (!row) {
      return null;
    }
    const memories = db
      .prepare(`
        SELECT memory_id, record_json
        FROM memories
        WHERE task_id = ?
        ORDER BY updated_at DESC, memory_id ASC
      `)
      .all(row.task_id);
    const events = db
      .prepare(`
        SELECT DISTINCT event_id, summary, created_at, generator
        FROM events
        WHERE event_id IN (
          SELECT json_extract(record_json, '$.latestEvidenceId')
          FROM memories
          WHERE task_id = ?
        )
        ORDER BY created_at DESC, event_id DESC
        LIMIT 12
      `)
      .all(row.task_id);
    return {
      taskId: row.task_id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
      memories: memories.map((memory) => ({
        memoryId: memory.memory_id,
        record: jsonLoads(memory.record_json, {}),
      })),
      events: events.map((event) => ({ ...event })),
    };
  } finally {
    db.close();
  }
}

function upsertTaskMemory(db, taskId, bullet, targetCollection, createdAt, eventId, quality) {
  const fingerprint = fingerprintText(`${taskId}|${targetCollection}|${bullet}`);
  const memoryId = buildMemoryId("task", fingerprint, taskId);
  const existing = db.prepare("SELECT record_json FROM memories WHERE memory_id = ?").get(memoryId);
  const score = Number.isInteger(quality?.score) ? quality.score : 0;
  const grade = typeof quality?.grade === "string" ? quality.grade : "D";
  let record;
  if (!existing) {
    record = {
      fingerprint,
      text: bullet,
      firstSeenAt: createdAt,
      lastSeenAt: createdAt,
      occurrences: 1,
      evidenceCount: 1,
      bestGrade: grade,
      bestScore: score,
      scoreSum: score,
      averageScore: score,
      confidence: Number((score / 100).toFixed(2)),
      promotionStatus: "candidate",
      firstPromotedAt: "",
      latestEvidenceId: eventId,
      sourceEvidenceIds: [eventId],
      collection: "task",
      scope: "task",
      kind: "task-note",
      taskId,
      targetCollection,
      paths: [],
      tool: "",
      requires: {},
      lifecycleStatus: "active",
    };
  } else {
    record = jsonLoads(existing.record_json, {});
    record.lastSeenAt = createdAt;
    record.latestEvidenceId = eventId;
    const sourceIds = Array.isArray(record.sourceEvidenceIds) ? record.sourceEvidenceIds : [];
    if (!sourceIds.includes(eventId)) {
      sourceIds.push(eventId);
    }
    record.sourceEvidenceIds = sourceIds;
    record.occurrences = Number.isInteger(record.occurrences) ? record.occurrences + 1 : 1;
    const nextEvidenceCount = Number.isInteger(record.evidenceCount) ? record.evidenceCount + 1 : 1;
    record.evidenceCount = nextEvidenceCount;
    const nextScoreSum = Number.isInteger(record.scoreSum) ? record.scoreSum + score : score;
    record.scoreSum = nextScoreSum;
    record.averageScore = Math.round(nextScoreSum / Math.max(1, nextEvidenceCount));
    record.confidence = Number(Math.min(1, record.averageScore / 100).toFixed(2));
    if (score >= Number(record.bestScore || 0)) {
      record.bestScore = score;
      record.bestGrade = grade;
      record.text = bullet;
    }
  }
  upsertMemoryRow(db, "task", fingerprint, record, { taskId });
  return memoryId;
}

function addTaskCapture(repoRoot, taskId, createdAt, eventId, quality, knowledge, candidateSpec) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  const createdIds = [];
  try {
    for (const bullet of knowledge) {
      createdIds.push(upsertTaskMemory(db, taskId, bullet, "knowledge", createdAt, eventId, quality));
    }
    for (const bullet of candidateSpec) {
      createdIds.push(upsertTaskMemory(db, taskId, bullet, "candidateSpec", createdAt, eventId, quality));
    }
  } finally {
    db.close();
  }
  refreshMemoryRelations(repoRoot);
  return createdIds;
}

function listPendingMemories(repoRoot) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const rows = db
      .prepare(`
        SELECT memory_id, collection_name, task_id, record_json, updated_at
        FROM memories
        WHERE promotion_status = 'candidate'
        ORDER BY updated_at DESC, memory_id ASC
      `)
      .all();
    return rows.map((row) => ({
      memoryId: row.memory_id,
      collection: row.collection_name,
      taskId: row.task_id || "",
      record: jsonLoads(row.record_json, {}),
    }));
  } finally {
    db.close();
  }
}

function promoteMemory(repoRoot, memoryId, createdAt) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const row = db
      .prepare(`
        SELECT memory_id, collection_name, task_id, record_json
        FROM memories
        WHERE memory_id = ?
        LIMIT 1
      `)
      .get(memoryId);
    if (!row) {
      return null;
    }
    const record = jsonLoads(row.record_json, {});
    if (!record || typeof record !== "object") {
      return null;
    }
    let targetCollection = row.collection_name;
    if (targetCollection === "task") {
      targetCollection = typeof record.targetCollection === "string" && record.targetCollection ? record.targetCollection : "knowledge";
      const promotedRecord = {
        ...record,
        collection: targetCollection,
        scope: "repo",
        promotionStatus: "promoted",
        firstPromotedAt: createdAt,
        lastValidatedAt: createdAt,
        lifecycleStatus: "active",
      };
      let fingerprint = typeof record.fingerprint === "string" && record.fingerprint ? record.fingerprint : "";
      if (!fingerprint) {
        fingerprint = fingerprintText(String(promotedRecord.text ?? ""));
        promotedRecord.fingerprint = fingerprint;
      }
      upsertMemoryRow(db, targetCollection, fingerprint, promotedRecord);
      const repoMemoryId = buildMemoryId(targetCollection, fingerprint);
      db.prepare(`
        UPDATE memories
        SET promotion_status = 'promoted',
            updated_at = ?,
            record_json = ?
        WHERE memory_id = ?
      `).run(createdAt, jsonDumps({ ...record, promotionStatus: "promoted", promotedAt: createdAt }), memoryId);
      addMemoryEdge(repoRoot, memoryId, repoMemoryId, "derives", createdAt, {
        source: "task-promotion",
        targetCollection,
      }, {
        dedupeKey: `task-promotion|${memoryId}|${repoMemoryId}`,
      });
      refreshMemoryRelations(repoRoot);
      return {
        memoryId,
        promotedCollection: targetCollection,
        promotedMemoryId: repoMemoryId,
        record: promotedRecord,
      };
    }
    if (["knowledge", "candidateSpec"].includes(targetCollection)) {
      const promotedRecord = {
        ...record,
        promotionStatus: "promoted",
        firstPromotedAt: record.firstPromotedAt || createdAt,
        lastValidatedAt: createdAt,
      };
      db.prepare(`
        UPDATE memories
        SET promotion_status = 'promoted',
            updated_at = ?,
            record_json = ?
        WHERE memory_id = ?
      `).run(createdAt, jsonDumps(promotedRecord), memoryId);
      upsertMemoryRow(db, targetCollection, String(promotedRecord.fingerprint ?? ""), promotedRecord, {
        taskId: String(row.task_id || ""),
      });
      refreshMemoryRelations(repoRoot);
      return {
        memoryId,
        promotedCollection: targetCollection,
        record: promotedRecord,
      };
    }
    return null;
  } finally {
    db.close();
  }
}

function ftsQuery(query) {
  const tokens = String(query ?? "").toLowerCase().match(TOKEN_RE) ?? [];
  return tokens.slice(0, 8).join(" AND ");
}

function recall(repoRoot, query, { scope = "", taskId = "", limit = 10 } = {}) {
  ensureStorage(repoRoot);
  const queryText = ftsQuery(query);
  const db = connect(repoRoot);
  try {
    let memoryRows = [];
    let eventRows = [];
    if (queryText) {
      let memorySql = `
        SELECT memories.memory_id, memories.collection_name, memories.task_id, memories.scope,
               memories.promotion_status, memories.record_json, bm25(memory_fts) AS rank
        FROM memory_fts
        JOIN memories ON memories.rowid = memory_fts.rowid
        WHERE memory_fts MATCH ?
      `;
      const memoryParams = [queryText];
      if (scope) {
        memorySql += " AND memories.scope = ?";
        memoryParams.push(scope);
      }
      if (taskId) {
        memorySql += " AND memories.task_id = ?";
        memoryParams.push(taskId);
      }
      memorySql += " ORDER BY rank LIMIT ?";
      memoryParams.push(limit);
      memoryRows = db.prepare(memorySql).all(...memoryParams);

      let eventSql = `
        SELECT events.event_id, events.created_at, events.generator, events.summary,
               event_chunks.chunk_type, event_chunks.text, bm25(event_chunks_fts) AS rank
        FROM event_chunks_fts
        JOIN event_chunks ON event_chunks.chunk_id = event_chunks_fts.rowid
        JOIN events ON events.event_id = event_chunks.event_id
        WHERE event_chunks_fts MATCH ?
      `;
      const eventParams = [queryText];
      if (taskId) {
        eventSql += " AND json_extract(events.evidence_json, '$.taskId') = ?";
        eventParams.push(taskId);
      } else if (scope === "task") {
        eventSql += " AND COALESCE(json_extract(events.evidence_json, '$.taskId'), '') != ''";
      } else if (scope === "repo") {
        eventSql += " AND COALESCE(json_extract(events.evidence_json, '$.taskId'), '') = ''";
      }
      eventSql += " ORDER BY rank LIMIT ?";
      eventParams.push(limit);
      eventRows = db.prepare(eventSql).all(...eventParams);
    }
    return {
      query,
      scope,
      taskId,
      memories: memoryRows.map((row) => {
        const record = jsonLoads(row.record_json, {});
        return {
          kind: "memory",
          memoryId: row.memory_id,
          collection: row.collection_name,
          scope: row.scope,
          taskId: row.task_id || "",
          promotionStatus: row.promotion_status,
          text: record.text ?? "",
          record,
          score: Math.abs(Number(row.rank ?? 0)),
        };
      }),
      events: eventRows.map((row) => ({
        kind: "event",
        eventId: row.event_id,
        createdAt: row.created_at,
        generator: row.generator,
        summary: row.summary,
        chunkType: row.chunk_type,
        text: row.text,
        score: Math.abs(Number(row.rank ?? 0)),
      })),
    };
  } finally {
    db.close();
  }
}

function buildRuleStore(repoRoot) {
  const mergeIndex = loadMergeIndexDb(repoRoot);
  const knowledgeDict = mergeIndex.knowledge ?? {};
  const specDict = mergeIndex.candidateSpec ?? {};
  return {
    version: 1,
    recordSchemaVersion: 2,
    updatedAt: "",
    collections: {
      knowledge: { ...summarizeRecordGroups(knowledgeDict), records: knowledgeDict },
      spec: { ...summarizeRecordGroups(specDict), records: specDict },
    },
  };
}

function resolveLineageRecord(repoRoot, fingerprint) {
  const mergeIndex = loadMergeIndexDb(repoRoot);
  const matches = [];
  for (const [label, records, runtimeCollection] of [
    ["knowledge", mergeIndex.knowledge ?? {}, "knowledge"],
    ["spec", mergeIndex.candidateSpec ?? {}, "candidateSpec"],
  ]) {
    for (const [recordFingerprint, record] of Object.entries(records)) {
      if (recordFingerprint === fingerprint || recordFingerprint.startsWith(fingerprint)) {
        matches.push({
          collection: label,
          runtimeCollection,
          fingerprint: recordFingerprint,
          record,
        });
      }
    }
  }
  if (matches.length === 0) {
    throw new Error(`No rule record found for fingerprint: ${fingerprint}`);
  }
  if (matches.length > 1) {
    throw new Error(`Fingerprint prefix is ambiguous: ${fingerprint}`);
  }
  const match = matches[0];
  const memoryId = buildMemoryId(match.runtimeCollection, String(match.fingerprint));
  const evidenceIds = Array.isArray(match.record.sourceEvidenceIds)
    ? match.record.sourceEvidenceIds.filter((item) => typeof item === "string")
    : [];
  return {
    collection: match.collection,
    fingerprint: match.fingerprint,
    memoryId,
    record: match.record,
    evidence: evidenceIds.map((eventId) => loadEvent(repoRoot, eventId)).filter(Boolean),
    edges: getMemoryEdges(repoRoot, memoryId),
  };
}

function buildRuntimeSummary(repoRoot) {
  ensureStorage(repoRoot);
  const db = connect(repoRoot);
  try {
    const pendingCountRow = db.prepare("SELECT COUNT(*) AS count FROM memories WHERE promotion_status = 'candidate'").get();
    const eventCountRow = db.prepare("SELECT COUNT(*) AS count FROM events").get();
    const memoryCountRow = db.prepare("SELECT COUNT(*) AS count FROM memories").get();
    const recentAuditRows = db
      .prepare(`
        SELECT created_at, action_type, entity_type, entity_id, details_json
        FROM audit_log
        ORDER BY audit_id DESC
        LIMIT 8
      `)
      .all();
    return {
      dbPath: getDbPath(repoRoot),
      eventCount: Number(eventCountRow.count),
      memoryCount: Number(memoryCountRow.count),
      memoryEdgeCount: getMemoryEdges(repoRoot).length,
      pendingPromotionCount: Number(pendingCountRow.count),
      activeTask: getActiveTask(repoRoot),
      adapterStates: getAdapterStates(repoRoot),
      adapterModes: getAdapterModes(repoRoot),
      recentAudit: recentAuditRows.map((row) => ({
        createdAt: row.created_at,
        actionType: row.action_type,
        entityType: row.entity_type,
        entityId: row.entity_id,
        details: jsonLoads(row.details_json, {}),
      })),
    };
  } finally {
    db.close();
  }
}

function writeRuntimeSummary(repoRoot) {
  const summary = buildRuntimeSummary(repoRoot);
  writeJson(path.join(repoRoot, MEMRAFT_DIR, "state", "runtime-summary.json"), summary);
  return summary;
}

function renderActiveTaskLines(repoRoot, { limit }) {
  const activeTask = getActiveTask(repoRoot);
  if (!activeTask || typeof activeTask !== "object") {
    return [];
  }
  const taskId = typeof activeTask.task_id === "string" ? activeTask.task_id : activeTask.taskId;
  if (!taskId) {
    return [];
  }
  const details = showTask(repoRoot, taskId);
  if (!details) {
    return [];
  }
  const lines = [
    `- Current task: ${details.title || taskId}`,
    `- Task id: ${details.taskId || taskId}`,
    `- Status: ${details.status || "active"}`,
  ];
  if (Array.isArray(details.memories)) {
    for (const item of details.memories.slice(0, limit)) {
      const record = item?.record;
      const text = record && typeof record === "object" ? record.text : "";
      if (typeof text === "string" && text.trim()) {
        lines.push(`- ${text.trim()}`);
      }
    }
  }
  return lines;
}

function renderAdapterRuntimeLines(adapterModes, { focusTool = "" } = {}) {
  const toolLabels = {
    codex: "Codex",
    gemini: "Gemini CLI",
    opencode: "OpenCode",
  };
  const orderedTools = focusTool ? [focusTool] : ["codex", "gemini", "opencode"];
  const lines = [];
  for (const toolName of orderedTools) {
    if (!(toolName in toolLabels)) {
      continue;
    }
    const state = adapterModes?.[toolName];
    if (!state || typeof state !== "object") {
      continue;
    }
    lines.push(`- ${toolLabels[toolName]} adapter mode: ${String(state.mode ?? "unknown")}`);
    if (toolName === "gemini") {
      lines.push("- Gemini CLI capture remains manual-only; use the manual capture path when you need persistence.");
      continue;
    }
    if (state.captureEnabled) {
      lines.push(`- Automatic ${toolLabels[toolName]} capture is enabled.`);
    } else {
      lines.push(
        `- Automatic ${toolLabels[toolName]} capture is unavailable; use \`node .memraft/hooks/manual_capture.mjs --tool ${toolName}\` when you need to persist this session.`,
      );
    }
  }
  return lines;
}

function renderCompiledSpecMarkdown(repoProfile, knowledgeRecords, specRecords) {
  return [
    "# Compiled Memraft Spec",
    "",
    "This file is compiled from repo facts plus promoted Memraft rules.",
    "",
    "## Repository Background",
    "",
    ...renderProfileLines(repoProfile, { compactCommands: false }),
    "",
    "## Stable Project Rules",
    "",
    ...renderPromotedLines(specRecords, {
      includeMeta: true,
      limit: 24,
      emptyMessage: "- No promoted rules yet.",
    }),
    "",
    "## Stable Learned Knowledge",
    "",
    ...renderPromotedLines(knowledgeRecords, {
      includeMeta: true,
      limit: 24,
      emptyMessage: "- No promoted knowledge yet.",
    }),
    "",
  ].join("\n");
}

function renderSessionStartInjection(repoRoot, repoProfile, latestEvidence, knowledgeRecords, specRecords, adapterModes) {
  const lines = [
    "<memraft-context>",
    "Use this compiled Memraft context when it helps.",
    "If repository code conflicts with a note below, trust the repository state.",
    "",
  ];
  const recentLines = renderRecentEvidenceLines(latestEvidence, { includeFiles: true, maxFiles: 8 });
  if (recentLines.length > 0) {
    lines.push("## Recent Evidence", ...recentLines, "");
  }
  const activeTaskLines = renderActiveTaskLines(repoRoot, { limit: 8 });
  if (activeTaskLines.length > 0) {
    lines.push("## Active Task", ...activeTaskLines, "");
  }
  const adapterLines = renderAdapterRuntimeLines(adapterModes);
  if (adapterLines.length > 0) {
    lines.push("## Adapter Runtime", ...adapterLines, "");
  }
  lines.push(
    "## Repository Background",
    ...renderProfileLines(repoProfile, { compactCommands: true }),
    "",
    "## Stable Project Rules",
    ...renderPromotedLines(specRecords, {
      includeMeta: false,
      limit: 10,
      emptyMessage: "- No promoted rules yet.",
    }),
    "",
    "## Stable Learned Knowledge",
    ...renderPromotedLines(knowledgeRecords, {
      includeMeta: false,
      limit: 10,
      emptyMessage: "- No promoted knowledge yet.",
    }),
    "</memraft-context>",
  );
  return lines.join("\n");
}

function renderSharedInjection(repoRoot, repoProfile, latestEvidence, knowledgeRecords, specRecords, adapterModes) {
  const lines = [
    "Use the compiled Memraft context below when useful.",
    "If repository code conflicts with a note below, trust the repository state.",
    "",
  ];
  const recentLines = renderRecentEvidenceLines(latestEvidence, { includeFiles: false, maxFiles: 0 });
  if (recentLines.length > 0) {
    lines.push("Recent evidence:", ...recentLines, "");
  }
  const activeTaskLines = renderActiveTaskLines(repoRoot, { limit: 6 });
  if (activeTaskLines.length > 0) {
    lines.push("Active task:", ...activeTaskLines, "");
  }
  const adapterLines = renderAdapterRuntimeLines(adapterModes);
  if (adapterLines.length > 0) {
    lines.push("Adapter runtime:", ...adapterLines, "");
  }
  lines.push(
    "Repository background:",
    ...renderProfileLines(repoProfile, { compactCommands: true }),
    "",
    "Stable project rules:",
    ...renderPromotedLines(specRecords, {
      includeMeta: false,
      limit: 6,
      emptyMessage: "- No promoted rules yet.",
    }),
    "",
    "Stable learned knowledge:",
    ...renderPromotedLines(knowledgeRecords, {
      includeMeta: false,
      limit: 6,
      emptyMessage: "- No promoted knowledge yet.",
    }),
  );
  return lines.join("\n");
}

function renderAdapterMarkdown(toolLabel, { repoRoot, filename, repoProfile, latestEvidence, knowledgeRecords, specRecords, adapterModes, adapterName }) {
  const lines = [
    `# Memraft Context For ${toolLabel}`,
    "",
    `This file is compiled for \`${filename}\` consumers from repo facts plus promoted Memraft rules.`,
    "If repository code conflicts with a note below, trust the repository state.",
    "",
    "## Repository Background",
    "",
    ...renderProfileLines(repoProfile, { compactCommands: false }),
    "",
    "## Stable Project Rules",
    "",
    ...renderPromotedLines(specRecords, {
      includeMeta: true,
      limit: 20,
      emptyMessage: "- No promoted rules yet.",
    }),
    "",
    "## Stable Learned Knowledge",
    "",
    ...renderPromotedLines(knowledgeRecords, {
      includeMeta: true,
      limit: 20,
      emptyMessage: "- No promoted knowledge yet.",
    }),
    "",
  ];
  const recentLines = renderRecentEvidenceLines(latestEvidence, { includeFiles: true, maxFiles: 6 });
  if (recentLines.length > 0) {
    lines.push("## Recent Evidence Snapshot", "", ...recentLines, "");
  }
  const activeTaskLines = renderActiveTaskLines(repoRoot, { limit: 6 });
  if (activeTaskLines.length > 0) {
    lines.push("## Active Task", "", ...activeTaskLines, "");
  }
  const adapterLines = renderAdapterRuntimeLines(adapterModes, { focusTool: adapterName });
  if (adapterLines.length > 0) {
    lines.push("## Adapter Runtime", "", ...adapterLines, "");
  }
  lines.push(...renderManualCaptureProtocolLines(), "");
  return lines.join("\n");
}

function getNativeEntrypointPaths(repoRoot) {
  return {
    agents: path.join(repoRoot, "AGENTS.md"),
    codexConfig: path.join(repoRoot, ".codex", "config.toml"),
    gemini: path.join(repoRoot, "GEMINI.md"),
    opencodeConfig: path.join(repoRoot, "opencode.json"),
    opencodePlugin: path.join(repoRoot, ".opencode", "plugins", "memraft-auto-capture.js"),
  };
}

function buildManagedMarkdownBlock(blockId, content) {
  const body = content.trimEnd();
  return `${MANAGED_BLOCK_PREFIX}${blockId}${MANAGED_BLOCK_SUFFIX}\n${body}\n${MANAGED_BLOCK_END_PREFIX}${blockId}${MANAGED_BLOCK_SUFFIX}\n`;
}

function upsertManagedMarkdownBlock(filePath, blockId, content) {
  const existing = readText(filePath, "");
  const block = buildManagedMarkdownBlock(blockId, content);
  const pattern = new RegExp(
    `${MANAGED_BLOCK_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${blockId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${MANAGED_BLOCK_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n[\\s\\S]*?\\r?\\n${MANAGED_BLOCK_END_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${blockId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${MANAGED_BLOCK_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n?`,
    "m",
  );
  const nextContent = pattern.test(existing)
    ? existing.replace(pattern, block)
    : existing.trim()
      ? `${existing.trimEnd()}\n\n${block}`
      : block;
  if (nextContent !== existing) {
    writeText(filePath, nextContent);
  }
}

function loadJsonObject(filePath) {
  const content = readText(filePath, "").trim();
  if (!content) {
    return {};
  }
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function ensureListWithValues(values, requiredValues) {
  const nextValues = [];
  const seen = new Set();
  if (Array.isArray(values)) {
    for (const item of values) {
      const normalized = typeof item === "string" ? item.trim() : "";
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      nextValues.push(normalized);
    }
  }
  for (const requiredValue of requiredValues) {
    const normalized = requiredValue.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    nextValues.push(normalized);
  }
  return nextValues;
}

function upsertOpencodeConfig(filePath, instructionPaths, pluginPaths) {
  const existing = readText(filePath, "");
  const data = loadJsonObject(filePath);
  if (data === null) {
    return false;
  }
  const nextPayload = { ...data };
  nextPayload.$schema ??= "https://opencode.ai/config.json";
  nextPayload.instructions = ensureListWithValues(nextPayload.instructions, instructionPaths);
  nextPayload.plugins = ensureListWithValues(nextPayload.plugins, pluginPaths);
  const rendered = `${JSON.stringify(nextPayload, null, 2)}\n`;
  if (rendered !== existing) {
    writeText(filePath, rendered);
  }
  return true;
}

function getNodeCommand() {
  return "node";
}

function buildRepoHookLoaderCode(moduleName, callArgs = []) {
  return [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { pathToFileURL } from 'node:url';",
    "let hookDir = null;",
    "const current = path.resolve(process.cwd());",
    "const candidates = [current];",
    "let cursor = current;",
    "while (true) { const parent = path.dirname(cursor); if (parent === cursor) break; candidates.push(parent); cursor = parent; }",
    "for (const candidate of candidates) {",
    "  const possible = path.join(candidate, '.memraft', 'hooks');",
    "  if (fs.existsSync(possible) && fs.statSync(possible).isDirectory()) { hookDir = possible; break; }",
    "}",
    "if (!hookDir) { process.exit(0); }",
    `const mod = await import(pathToFileURL(path.join(hookDir, '${moduleName}.mjs')).href);`,
    `const exitCode = await mod.main(${JSON.stringify(callArgs)}.concat(process.argv.slice(1)));`,
    "if (Number.isInteger(exitCode)) { process.exit(exitCode); }",
  ].join("\n");
}

function renderTomlString(value) {
  if (value.includes("\n")) {
    return `"""\n${value.replaceAll("\\", "\\\\").replaceAll('"""', '\\"""')}\n"""`;
  }
  return JSON.stringify(value);
}

function renderCodexConfig() {
  const command = [getNodeCommand(), "--input-type=module", "-e", buildRepoHookLoaderCode("codex_notify")];
  const renderedItems = command.map((item) => `  ${renderTomlString(item)}`).join(",\n");
  return [
    "# Managed by Memraft. Keep other repo-local Codex settings outside this block.",
    "# MEMRAFT:BEGIN codex-notify",
    "notify = [",
    renderedItems,
    "]",
    "# MEMRAFT:END codex-notify",
    "",
  ].join("\n");
}

function upsertCodexConfig(filePath, managedContent) {
  const existing = readText(filePath, "");
  const blockPattern = /# MEMRAFT:BEGIN codex-notify\r?\n[\s\S]*?\r?\n# MEMRAFT:END codex-notify\r?\n?/m;
  let nextContent;
  if (blockPattern.test(existing)) {
    nextContent = existing.replace(blockPattern, managedContent);
  } else {
    if (/^[ \t]*notify[ \t]*=/m.test(existing)) {
      return false;
    }
    nextContent = existing.trim() ? `${existing.trimEnd()}\n\n${managedContent}` : managedContent;
  }
  if (nextContent !== existing) {
    writeText(filePath, nextContent);
  }
  return true;
}

function canManageCodexConfig(filePath) {
  const existing = readText(filePath, "");
  if (/# MEMRAFT:BEGIN codex-notify\r?\n[\s\S]*?\r?\n# MEMRAFT:END codex-notify/m.test(existing)) {
    return true;
  }
  return !/^[ \t]*notify[ \t]*=/m.test(existing);
}

function renderOpencodePlugin() {
  const nodeCode = JSON.stringify(buildRepoHookLoaderCode("auto_capture", ["--tool", "opencode"]));
  return [
    "// Managed by Memraft. Do not edit manually.",
    "import { spawn } from 'node:child_process'",
    "",
    `const NODE_CODE = ${nodeCode}`,
    "",
    "function fire(eventType, event) {",
    "  try {",
    "    const child = spawn('node', [",
    "      '--input-type=module',",
    "      '-e',",
    "      NODE_CODE,",
    "      `--event-type=${eventType}`,",
    "      JSON.stringify(event ?? {})",
    "    ], {",
    "      detached: true,",
    "      stdio: 'ignore',",
    "      windowsHide: true",
    "    })",
    "    child.unref()",
    "  } catch (_error) {",
    "  }",
    "}",
    "",
    "export const MemraftAutoCapturePlugin = async () => ({",
    "  event: async ({ event }) => {",
    "    const eventType = event?.type",
    "    if (eventType === 'session.idle' || eventType === 'session.error') {",
    "      fire(eventType, event)",
    "    }",
    "  }",
    "})",
    "",
  ].join("\n");
}

function buildProjectAgentsMarkdown(codexMarkdown) {
  const lines = codexMarkdown.trimEnd().split(/\r?\n/);
  if (lines[0]?.startsWith("# ")) {
    lines[0] = "# Memraft Context";
  }
  return `${lines.join("\n")}\n`;
}

function planNativeAdapterStates(repoRoot, outputPaths) {
  const entrypoints = getNativeEntrypointPaths(repoRoot);
  return {
    nativeAgents: ["managed", { path: entrypoints.agents, mode: "managed-block" }],
    nativeCodexConfig: [
      canManageCodexConfig(entrypoints.codexConfig) ? "managed" : "conflict",
      { path: entrypoints.codexConfig, mode: "notify-block" },
    ],
    nativeGemini: ["managed", { path: entrypoints.gemini, mode: "managed-block" }],
    nativeOpencodePlugin: ["managed", { path: entrypoints.opencodePlugin, mode: "copied-plugin" }],
    nativeOpencodeConfig: [
      loadJsonObject(entrypoints.opencodeConfig) !== null ? "managed" : "conflict",
      { path: entrypoints.opencodeConfig, mode: "config-merge" },
    ],
  };
}

function syncNativeAdapters(repoRoot, config = loadConfig(repoRoot), outputPaths = getCompileOutputPaths(repoRoot, config)) {
  const entrypoints = getNativeEntrypointPaths(repoRoot);
  const adapterStates = planNativeAdapterStates(repoRoot, outputPaths);
  const updatedAt = nowIso();
  const codexMarkdown = readText(outputPaths.codexAgents, "");
  if (codexMarkdown.trim()) {
    upsertManagedMarkdownBlock(entrypoints.agents, "project-context", buildProjectAgentsMarkdown(codexMarkdown));
  }
  const codexConfig = readText(outputPaths.codexConfig, "");
  if (codexConfig.trim()) {
    upsertCodexConfig(entrypoints.codexConfig, codexConfig);
  }
  const geminiMarkdown = readText(outputPaths.geminiContext, "");
  if (geminiMarkdown.trim()) {
    upsertManagedMarkdownBlock(entrypoints.gemini, "project-context", `${geminiMarkdown.trimEnd()}\n`);
  }
  const toolInjectionRelative = path.posix.normalize(path.relative(repoRoot, outputPaths.toolInjection).replaceAll(path.sep, "/"));
  const opencodePluginRelative = path.posix.normalize(path.relative(repoRoot, entrypoints.opencodePlugin).replaceAll(path.sep, "/"));
  const opencodePlugin = readText(outputPaths.opencodePlugin, "");
  if (opencodePlugin.trim()) {
    writeText(entrypoints.opencodePlugin, opencodePlugin);
  }
  upsertOpencodeConfig(entrypoints.opencodeConfig, ["AGENTS.md", toolInjectionRelative], [opencodePluginRelative]);
  for (const [adapterName, [ownership, details]] of Object.entries(adapterStates)) {
    setAdapterState(repoRoot, adapterName, ownership, details, updatedAt);
  }
}

function renderOpencodeConfig(repoRoot, outputPaths) {
  return `${JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      instructions: [
        "AGENTS.md",
        path.posix.normalize(path.relative(repoRoot, outputPaths.toolInjection).replaceAll(path.sep, "/")),
      ],
      plugins: [".opencode/plugins/memraft-auto-capture.js"],
    },
    null,
    2,
  )}\n`;
}

function buildAdapterManifest(outputPaths) {
  return {
    version: 1,
    updatedAt: nowIso(),
    adapters: {
      codex: {
        generatedPath: outputPaths.codexAgents,
        recommendedProjectFile: "AGENTS.md",
        configSnippetPath: outputPaths.codexConfig,
        mode: "static-project-instructions",
      },
      gemini: {
        generatedPath: outputPaths.geminiContext,
        recommendedProjectFile: "GEMINI.md",
        mode: "static-project-instructions",
      },
      opencode: {
        generatedPath: outputPaths.opencodeAgents,
        recommendedProjectFile: "AGENTS.md",
        configSnippetPath: outputPaths.opencodeConfig,
        pluginPath: outputPaths.opencodePlugin,
        mode: "static-project-instructions",
      },
    },
  };
}

function mergeCollection(records, bullets, collectionName, createdAt, eventId, quality, promotionRules) {
  const stats = {
    added: 0,
    updated: 0,
    skipped: 0,
    promoted: 0,
    currentPromoted: 0,
    currentCandidates: 0,
  };
  const score = Number.isInteger(quality?.score) ? quality.score : 0;
  const grade = typeof quality?.grade === "string" ? quality.grade : "D";
  for (const bullet of bullets) {
    const fingerprint = fingerprintText(bullet);
    if (!fingerprint) {
      stats.skipped += 1;
      continue;
    }
    let record = coerceRecord(records[fingerprint]);
    if (!record) {
      const metadata = buildRuleMetadata(bullet, collectionName);
      record = {
        fingerprint,
        text: bullet,
        firstSeenAt: createdAt,
        lastSeenAt: createdAt,
        occurrences: 1,
        evidenceCount: 1,
        bestGrade: grade,
        bestScore: score,
        scoreSum: score,
        averageScore: score,
        confidence: calculateConfidence(score, 1),
        promotionStatus: "candidate",
        firstPromotedAt: "",
        latestEvidenceId: eventId,
        sourceEvidenceIds: [eventId],
        collection: collectionName,
        kind: metadata.kind,
        scope: metadata.scope,
        paths: metadata.paths,
        tool: metadata.tool,
        requires: metadata.requires,
        lifecycleStatus: "active",
        invalidatedAt: "",
        invalidationReason: "",
        lastValidatedAt: "",
        demotedAt: "",
        restoredAt: "",
      };
      if (updatePromotionStatus(record, promotionRules, createdAt)) {
        stats.promoted += 1;
      }
      records[fingerprint] = record;
      stats.added += 1;
      continue;
    }
    ensureRuleRecordShape(record, collectionName);
    record.lastSeenAt = createdAt;
    record.latestEvidenceId = eventId;
    record.sourceEvidenceIds = mergeStringLists(record.sourceEvidenceIds ?? [], [eventId]);
    record.occurrences = Number.isInteger(record.occurrences) ? record.occurrences + 1 : 1;
    record.evidenceCount = Number.isInteger(record.evidenceCount) ? record.evidenceCount + 1 : 1;
    const nextScoreSum = (Number.isInteger(record.scoreSum) ? record.scoreSum : 0) + score;
    record.scoreSum = nextScoreSum;
    record.averageScore = Math.round(nextScoreSum / record.evidenceCount);
    record.confidence = calculateConfidence(record.averageScore, record.evidenceCount);
    const existingScore = Number.isInteger(record.bestScore) ? record.bestScore : 0;
    const existingText = typeof record.text === "string" ? record.text : "";
    const shouldReplace = score > existingScore || (score === existingScore && bullet.length > existingText.length);
    if (shouldReplace) {
      const metadata = buildRuleMetadata(bullet, collectionName);
      if (bullet !== existingText) {
        stats.updated += 1;
      }
      record.text = bullet;
      record.bestScore = score;
      record.bestGrade = grade;
      record.collection = collectionName;
      record.kind = metadata.kind;
      record.scope = metadata.scope;
      record.paths = metadata.paths;
      record.tool = metadata.tool;
      record.requires = metadata.requires;
    } else {
      stats.skipped += 1;
    }
    if (updatePromotionStatus(record, promotionRules, createdAt)) {
      stats.promoted += 1;
    }
  }
  for (const record of Object.values(records)) {
    if (!record || typeof record !== "object") {
      continue;
    }
    const status = typeof record.promotionStatus === "string" ? record.promotionStatus : "candidate";
    if (status === "promoted") {
      stats.currentPromoted += 1;
    } else {
      stats.currentCandidates += 1;
    }
  }
  return [records, stats];
}

function renderCollectionMarkdown(title, intro, records, promotionRules) {
  const [promotedRecords, candidateRecords, invalidatedRecords] = partitionRankedRecords(records);
  const lines = [
    `# ${title}`,
    "",
    intro,
    "",
    "## Promotion Rules",
    "",
    `- Promote after x${promotionRules.minimumOccurrences ?? 2} repeated occurrences, ${promotionRules.minimumEvidenceCount ?? 2} evidence events, confidence >= ${(promotionRules.minimumConfidence ?? 0.68).toFixed(2)}.`,
    "- Only promoted entries are injected back into Claude context.",
    "",
    "## Promoted Entries",
    "",
  ];
  const appendRecords = (collection, emptyMessage) => {
    if (collection.length === 0) {
      lines.push(emptyMessage);
      return;
    }
    for (const record of collection) {
      lines.push(formatRecordLine(record, { includeMeta: true }));
    }
  };
  appendRecords(promotedRecords, "- No promoted entries yet.");
  lines.push("", "## Candidate Queue", "");
  appendRecords(candidateRecords, "- No candidate entries yet.");
  lines.push("", "## Invalidated Entries", "");
  appendRecords(invalidatedRecords, "- No invalidated entries.");
  return `${lines.join("\n").trim()}\n`;
}

function writeMergeOutputs(repoRoot, config, mergeIndex, promotionRules) {
  const mergeIndexPath = path.join(repoRoot, MEMRAFT_DIR, "state", "merge-index.json");
  saveMergeIndexDb(repoRoot, mergeIndex);
  writeJson(mergeIndexPath, mergeIndex);
  const knowledgeDict = mergeIndex.knowledge ?? {};
  const candidateDict = mergeIndex.candidateSpec ?? {};
  writeText(
    getArtifactPath(repoRoot, config, "memoryPath", "knowledge/memory.md"),
    renderCollectionMarkdown(
      "Shared Knowledge Memory",
      "This file is auto-generated from deduplicated session evidence.",
      knowledgeDict,
      promotionRules,
    ),
  );
  writeText(
    getArtifactPath(repoRoot, config, "candidateSpecPath", "specs/candidate-spec.md"),
    renderCollectionMarkdown(
      "Candidate Spec Draft",
      "This file stores deduplicated candidate conventions, contracts, and workflows.",
      candidateDict,
      promotionRules,
    ),
  );
}

function reconcileMergeIndex(repoRoot, mergeIndex, repoProfile, promotionRules) {
  let changed = false;
  const validatedAt = nowIso();
  for (const collectionName of ["knowledge", "candidateSpec"]) {
    const records = mergeIndex[collectionName] && typeof mergeIndex[collectionName] === "object" ? mergeIndex[collectionName] : {};
    for (const value of Object.values(records)) {
      const record = coerceRecord(value);
      if (record && reconcileRuleRecord(record, collectionName, repoRoot, repoProfile, promotionRules, validatedAt)) {
        changed = true;
      }
    }
    mergeIndex[collectionName] = records;
  }
  return changed;
}

function buildRuleStoreCollection(records) {
  const [promotedRecords, candidateRecords, invalidatedRecords] = partitionRankedRecords(records);
  return {
    ...summarizeRecordGroups(records),
    promotedFingerprints: promotedRecords.map((record) => getStringValue(record, "fingerprint")).filter(Boolean),
    candidateFingerprints: candidateRecords.map((record) => getStringValue(record, "fingerprint")).filter(Boolean),
    invalidatedFingerprints: invalidatedRecords.map((record) => getStringValue(record, "fingerprint")).filter(Boolean),
    records,
  };
}

function buildCompiledState(config, mergeIndex, repoProfile, latestEvidence, adapterModes) {
  const payload = {
    version: COMPILE_STATE_VERSION,
    repoProfile,
    mergeIndex,
    config,
    latestEvidence: {
      eventId: latestEvidence.eventId,
      summary: latestEvidence.summary,
      generator: latestEvidence.generator,
      quality: latestEvidence.quality,
      files: Array.isArray(latestEvidence.files) ? latestEvidence.files.slice(0, MAX_COMPILE_CACHE_RECENT_FILES) : [],
      source:
        latestEvidence.source && typeof latestEvidence.source === "object"
          ? {
              transcriptChars: latestEvidence.source.transcriptChars,
              diffChars: latestEvidence.source.diffChars,
              sessionEndDeferred: latestEvidence.source.sessionEndDeferred,
              sessionEndFallback: latestEvidence.source.sessionEndFallback,
            }
          : {},
    },
    counts: {
      knowledge: Object.keys(mergeIndex.knowledge ?? {}).length,
      candidateSpec: Object.keys(mergeIndex.candidateSpec ?? {}).length,
    },
    adapterModes,
  };
  return {
    version: COMPILE_STATE_VERSION,
    updatedAt: nowIso(),
    inputHash: hashJsonPayload(payload),
  };
}

function hasFreshCompiledOutputs(repoRoot, config, compiledState, expectedHash) {
  return getStringValue(compiledState, "inputHash") === expectedHash && compileOutputsExist(getCompileOutputPaths(repoRoot, config));
}

function writeCompiledState(repoRoot, compiledState) {
  writeJson(getCompiledStatePath(repoRoot), compiledState);
}

function writeCompiledOutputs(repoRoot, config, mergeIndex, latestEvidence = null, repoProfile = null) {
  ensureStorage(repoRoot);
  validateConfiguredPaths(repoRoot, config);
  const promotionRules = getPromotionRules(config);
  let knowledgeDict = mergeIndex.knowledge ?? {};
  let specDict = mergeIndex.candidateSpec ?? {};
  let nextRepoProfile = repoProfile && typeof repoProfile === "object" ? repoProfile : scanRepoProfile(repoRoot, config);
  nextRepoProfile = stabilizeRepoProfile(repoRoot, config, nextRepoProfile);
  if (reconcileMergeIndex(repoRoot, mergeIndex, nextRepoProfile, promotionRules)) {
    writeMergeOutputs(repoRoot, config, mergeIndex, promotionRules);
    knowledgeDict = mergeIndex.knowledge ?? {};
    specDict = mergeIndex.candidateSpec ?? {};
  }
  const ruleStore = {
    version: 1,
    recordSchemaVersion: 2,
    updatedAt: nowIso(),
    repoProfile: nextRepoProfile,
    collections: {
      knowledge: buildRuleStoreCollection(knowledgeDict),
      spec: buildRuleStoreCollection(specDict),
    },
  };
  const latest = latestEvidence && typeof latestEvidence === "object" ? latestEvidence : loadLatestEvidenceDb(repoRoot);
  const outputPaths = getCompileOutputPaths(repoRoot, config);
  const adapterStatePlan = planNativeAdapterStates(repoRoot, outputPaths);
  const adapterModes = buildAdapterModesFromStates(
    Object.fromEntries(Object.entries(adapterStatePlan).map(([name, [ownership, details]]) => [name, { ownership, details }])),
  );
  const compiledState = buildCompiledState(config, mergeIndex, nextRepoProfile, latest, adapterModes);
  writeJson(outputPaths.repoProfile, nextRepoProfile);
  writeJson(outputPaths.ruleStore, ruleStore);
  writeText(outputPaths.compiledSpec, renderCompiledSpecMarkdown(nextRepoProfile, knowledgeDict, specDict));
  writeText(
    outputPaths.sessionStartInjection,
    renderSessionStartInjection(repoRoot, nextRepoProfile, latest, knowledgeDict, specDict, adapterModes),
  );
  const sharedInjection = renderSharedInjection(repoRoot, nextRepoProfile, latest, knowledgeDict, specDict, adapterModes);
  writeText(outputPaths.toolInjection, sharedInjection);
  writeText(outputPaths.subagentInjection, sharedInjection);
  writeText(
    outputPaths.codexAgents,
    renderAdapterMarkdown("Codex", {
      repoRoot,
      filename: "AGENTS.md",
      repoProfile: nextRepoProfile,
      latestEvidence: latest,
      knowledgeRecords: knowledgeDict,
      specRecords: specDict,
      adapterModes,
      adapterName: "codex",
    }),
  );
  writeText(outputPaths.codexConfig, renderCodexConfig());
  writeText(
    outputPaths.geminiContext,
    renderAdapterMarkdown("Gemini CLI", {
      repoRoot,
      filename: "GEMINI.md",
      repoProfile: nextRepoProfile,
      latestEvidence: latest,
      knowledgeRecords: knowledgeDict,
      specRecords: specDict,
      adapterModes,
      adapterName: "gemini",
    }),
  );
  writeText(
    outputPaths.opencodeAgents,
    renderAdapterMarkdown("OpenCode", {
      repoRoot,
      filename: "AGENTS.md",
      repoProfile: nextRepoProfile,
      latestEvidence: latest,
      knowledgeRecords: knowledgeDict,
      specRecords: specDict,
      adapterModes,
      adapterName: "opencode",
    }),
  );
  writeText(outputPaths.opencodeConfig, renderOpencodeConfig(repoRoot, outputPaths));
  writeText(outputPaths.opencodePlugin, renderOpencodePlugin());
  writeJson(outputPaths.adapterManifest, buildAdapterManifest(outputPaths));
  writeCompiledState(repoRoot, compiledState);
  syncNativeAdapters(repoRoot, config, outputPaths);
  writeRuntimeSummary(repoRoot);
}

export function ensureCompiledArtifacts(repoRoot) {
  ensureStorage(repoRoot);
  const config = loadConfig(repoRoot);
  validateConfiguredPaths(repoRoot, config);
  const mergeIndex = loadMergeIndexDb(repoRoot);
  const promotionRules = getPromotionRules(config);
  const latest = loadLatestEvidenceDb(repoRoot);
  let repoProfile = scanRepoProfile(repoRoot, config);
  repoProfile = stabilizeRepoProfile(repoRoot, config, repoProfile);
  if (reconcileMergeIndex(repoRoot, mergeIndex, repoProfile, promotionRules)) {
    writeMergeOutputs(repoRoot, config, mergeIndex, promotionRules);
  }
  const outputPaths = getCompileOutputPaths(repoRoot, config);
  const adapterStatePlan = planNativeAdapterStates(repoRoot, outputPaths);
  const adapterModes = buildAdapterModesFromStates(
    Object.fromEntries(Object.entries(adapterStatePlan).map(([name, [ownership, details]]) => [name, { ownership, details }])),
  );
  const compiledState = buildCompiledState(config, mergeIndex, repoProfile, latest, adapterModes);
  if (hasFreshCompiledOutputs(repoRoot, config, loadCompiledState(repoRoot), getStringValue(compiledState, "inputHash"))) {
    syncNativeAdapters(repoRoot, config, outputPaths);
    return;
  }
  writeCompiledOutputs(repoRoot, config, mergeIndex, latest, repoProfile);
}

function writeEvidence(repoRoot, config, evidence) {
  writeJson(getArtifactPath(repoRoot, config, "latestEvidencePath", "evidence/latest.json"), evidence);
  writeJson(getSessionEvidencePath(repoRoot, String(evidence.eventId ?? "event")), evidence);
}

function writeSyncOutbox(repoRoot, config, evidence) {
  const sync = config?.sync;
  if (!sync || typeof sync !== "object" || sync.enabled !== true) {
    return;
  }
  const repoKey =
    typeof sync.repoKey === "string" && sync.repoKey
      ? sync.repoKey
      : normalizeText(String(config.projectName ?? "repo")).replaceAll(" ", "-");
  const outboxDir = typeof sync.outboxDir === "string" && sync.outboxDir ? sync.outboxDir : "sync/outbox";
  const envelope = {
    protocolVersion: 1,
    eventType: "session_evidence",
    eventId: evidence.eventId,
    createdAt: evidence.createdAt,
    repo: {
      key: repoKey,
      name: config.projectName,
      scope: typeof sync.scope === "string" && sync.scope ? sync.scope : "repo",
      publicNamespaces: Array.isArray(sync.publicNamespaces)
        ? sync.publicNamespaces.filter((item) => typeof item === "string" && item)
        : [],
    },
    session: {
      id: evidence.sessionId,
      reason: evidence.reason,
    },
    evidence: {
      summary: evidence.summary,
      files: evidence.files,
      generator: evidence.generator,
      quality: evidence.quality,
    },
    artifacts: {
      knowledge: Array.isArray(evidence.knowledge) ? evidence.knowledge : [],
      candidateSpec: Array.isArray(evidence.candidateSpec) ? evidence.candidateSpec : [],
    },
    merge: evidence.merge && typeof evidence.merge === "object" ? evidence.merge : {},
  };
  writeJson(
    resolveMemraftPath(repoRoot, `${outboxDir}/${String(evidence.eventId ?? "event")}.json`, { label: "sync.outboxDir" }),
    envelope,
  );
}

function getSummaryStatePath(repoRoot) {
  return path.join(repoRoot, MEMRAFT_DIR, "state", "summary-state.json");
}

function loadSummaryState(repoRoot) {
  const data = readJson(getSummaryStatePath(repoRoot));
  if (!data || typeof data !== "object") {
    return { requests: {} };
  }
  return { requests: data.requests && typeof data.requests === "object" ? data.requests : {} };
}

function pruneSummaryState(state, keep = 200) {
  const requests = state?.requests;
  if (!requests || typeof requests !== "object" || Array.isArray(requests)) {
    return { requests: {} };
  }
  const values = Object.values(requests).filter((value) => value && typeof value === "object" && !Array.isArray(value));
  if (values.length <= keep) {
    return { requests };
  }
  const ordered = values.sort((left, right) =>
    String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")),
  );
  return {
    requests: Object.fromEntries(
      ordered
        .slice(0, keep)
        .filter((record) => typeof record.requestId === "string")
        .map((record) => [record.requestId, record]),
    ),
  };
}

function saveSummaryState(repoRoot, state) {
  writeJson(getSummaryStatePath(repoRoot), pruneSummaryState(state));
}

function listSummaryRequests(state, { sessionId = null, statuses = null } = {}) {
  const requests = state?.requests;
  if (!requests || typeof requests !== "object" || Array.isArray(requests)) {
    return [];
  }
  const matches = [];
  for (const value of Object.values(requests)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    if (sessionId !== null && getStringValue(value, "sessionId") !== sessionId) {
      continue;
    }
    if (statuses && !statuses.has(getStringValue(value, "status"))) {
      continue;
    }
    matches.push(value);
  }
  return matches.sort((left, right) =>
    String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")),
  );
}

function findRequestByAgentId(state, agentId) {
  if (!agentId) {
    return null;
  }
  return listSummaryRequests(state).find((request) => getStringValue(request, "agentId") === agentId) ?? null;
}

function findRequestByMessageFingerprint(state, sessionId, messageFingerprint) {
  if (!sessionId || !messageFingerprint) {
    return null;
  }
  return (
    listSummaryRequests(state, { sessionId }).find(
      (request) => getStringValue(request, "messageFingerprint") === messageFingerprint,
    ) ?? null
  );
}

function buildSummaryRequest(inputData, repoRoot, stopConfig, snapshot) {
  const lastMessage = getLastAssistantMessage(inputData).trim();
  const messageFingerprint = fingerprintText(lastMessage).slice(0, 16);
  const files = Array.isArray(snapshot.worktreeFiles) ? snapshot.worktreeFiles : [];
  const event = buildEvent(inputData, repoRoot, {
    eventKind: "stop_summary",
    messageFingerprint,
    snapshot,
  });
  return {
    requestId: String(event.eventId),
    event,
    sessionId: String(event.sessionId),
    transcriptPath: String(event.transcriptPath),
    messageFingerprint,
    assistantMessageExcerpt: lastMessage.slice(0, stopConfig.maxAssistantExcerptChars),
    assistantMessageChars: lastMessage.length,
    filesSnapshot: files.slice(0, 20),
    agentName: String(stopConfig.agentName),
    agentId: "",
    status: "pending",
    blockCount: 0,
    createdAt: String(event.createdAt),
    updatedAt: String(event.createdAt),
  };
}

function shouldRequestStopSummary(stopConfig, files, lastMessage) {
  return files.length >= stopConfig.minimumChangedFiles || (stopConfig.allowWithoutChanges && lastMessage.trim().length >= stopConfig.minimumAssistantChars);
}

function buildStopReason(request, stopConfig) {
  const agentName = getStringValue(request, "agentName") || String(stopConfig.agentName);
  const requestId = getStringValue(request, "requestId");
  const fileLines = Array.isArray(request.filesSnapshot)
    ? request.filesSnapshot
        .slice(0, stopConfig.maxFilesInReason)
        .filter((item) => typeof item === "string" && item)
        .map((item) => `- ${item}`)
    : [];
  const lines = [
    `Before stopping, launch the \`${agentName}\` subagent exactly once for Memraft summary request \`${requestId}\`.`,
    "Ask it to return strict JSON with keys `summary`, `knowledge`, and `candidate_spec`.",
    "The hook system will attach the request context automatically.",
    "Do not rewrite that JSON yourself. Let the subagent finish, then stop.",
  ];
  if (fileLines.length > 0) {
    lines.push("Relevant changed files:", ...fileLines);
  }
  const reason = lines.join("\n").trim();
  return reason.length <= stopConfig.maxReasonChars ? reason : reason.slice(0, stopConfig.maxReasonChars).trimEnd();
}

function persistSummary(repoRoot, event, payload, generator, sourceMeta = null) {
  const eventId = getStringValue(event, "eventId");
  const existing = readJson(getSessionEvidencePath(repoRoot, eventId));
  if (existing) {
    return existing;
  }
  const config = loadConfig(repoRoot);
  const captureConfig = getCaptureConfig(config);
  const promotionRules = getPromotionRules(config);
  const excludedPrefixes = Array.isArray(captureConfig.excludePathPrefixes)
    ? captureConfig.excludePathPrefixes
    : DEFAULT_CAPTURE_CONFIG.excludePathPrefixes;
  let files = Array.isArray(event.worktreeFiles)
    ? event.worktreeFiles.filter((item) => typeof item === "string" && item)
    : getWorktreeFiles(repoRoot, excludedPrefixes);
  let usedWorktreeSnapshot = Array.isArray(event.worktreeFiles);
  let diffText = typeof event.worktreeDiff === "string" ? event.worktreeDiff : getWorktreeDiff(repoRoot, captureConfig.maxDiffChars, excludedPrefixes);
  if (typeof event.worktreeDiff === "string") {
    usedWorktreeSnapshot = true;
  }
  const transcriptText = readTranscriptExcerpt(getStringValue(event, "transcriptPath"), captureConfig.maxTranscriptChars);
  let summary = typeof payload.summary === "string" ? payload.summary.trim() : "";
  if (!summary) {
    summary = "Session captured.";
  }
  const knowledge = cleanBullets(payload.knowledge);
  const candidateSpec = cleanBullets(payload.candidate_spec ?? payload.candidateSpec ?? []);
  const quality = scoreQuality(transcriptText, diffText, files, generator, summary, knowledge, candidateSpec, {
    manualCapture: Boolean(sourceMeta?.manualCapture),
  });
  const [eligible, minimumGrade] = mergeAllowed(quality, config);
  const activeTask = getActiveTask(repoRoot);
  const taskId =
    activeTask && typeof activeTask === "object"
      ? typeof activeTask.task_id === "string" && activeTask.task_id
        ? activeTask.task_id
        : activeTask.taskId || ""
      : "";
  const mergeIndex = loadMergeIndexDb(repoRoot);
  const knowledgeDict = mergeIndex.knowledge ?? {};
  const candidateDict = mergeIndex.candidateSpec ?? {};
  let knowledgeStats = { added: 0, updated: 0, skipped: knowledge.length };
  let candidateStats = { added: 0, updated: 0, skipped: candidateSpec.length };
  const shouldMergeRepoMemory = eligible && !taskId;
  if (shouldMergeRepoMemory) {
    const createdAt = getStringValue(event, "createdAt") || nowIso();
    [mergeIndex.knowledge, knowledgeStats] = mergeCollection(
      knowledgeDict,
      knowledge,
      "knowledge",
      createdAt,
      eventId,
      quality,
      promotionRules,
    );
    [mergeIndex.candidateSpec, candidateStats] = mergeCollection(
      candidateDict,
      candidateSpec,
      "candidateSpec",
      createdAt,
      eventId,
      quality,
      promotionRules,
    );
    writeMergeOutputs(repoRoot, config, mergeIndex, promotionRules);
  }
  const source = {
    transcriptAvailable: Boolean(transcriptText.trim()),
    transcriptChars: transcriptText.trim().length,
    diffChars: diffText.trim().length,
  };
  if (usedWorktreeSnapshot) {
    source.worktreeSnapshotUsed = true;
  }
  const capturedAt = getStringValue(event, "worktreeCapturedAt");
  if (capturedAt) {
    source.worktreeSnapshotCapturedAt = capturedAt;
  }
  if (sourceMeta && typeof sourceMeta === "object") {
    Object.assign(source, sourceMeta);
  }
  const evidence = {
    eventId,
    eventKind: event.eventKind,
    createdAt: event.createdAt,
    sessionId: event.sessionId,
    reason: event.reason,
    summary,
    files,
    generator,
    quality,
    knowledge,
    candidateSpec,
    merge: {
      minimumGrade,
      eligible,
      appliedToRepoMemory: shouldMergeRepoMemory,
      promotion: promotionRules,
      knowledge: knowledgeStats,
      candidateSpec: candidateStats,
    },
    source,
  };
  if (taskId) {
    evidence.taskId = taskId;
    addTaskCapture(repoRoot, taskId, String(evidence.createdAt || nowIso()), eventId, quality, knowledge, candidateSpec);
    evidence.taskCapture = {
      taskId,
      memoryCount: knowledge.length + candidateSpec.length,
    };
  }
  writeEvidence(repoRoot, config, evidence);
  storeEvent(repoRoot, event, payload, evidence, { transcriptText, diffText });
  writeSyncOutbox(repoRoot, config, evidence);
  writeCompiledOutputs(repoRoot, config, mergeIndex, evidence);
  writeAuditEntry(repoRoot, String(evidence.createdAt || nowIso()), "capture.persisted", "event", eventId, {
    generator,
    eligible,
    taskId: evidence.taskId ?? "",
    knowledgeCount: knowledge.length,
    candidateSpecCount: candidateSpec.length,
  });
  return evidence;
}

function parseFlagArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        result[key] = true;
        continue;
      }
      result[key] = next;
      index += 1;
      continue;
    }
    result._.push(arg);
  }
  return result;
}

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function resolveHookRepoRoot(inputData = {}) {
  const cwdValue = inputData?.cwd;
  return typeof cwdValue === "string" && cwdValue ? findRepoRoot(cwdValue) : findRepoRoot();
}

function findNestedString(data, keys) {
  if (!data || typeof data !== "object") {
    return "";
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const match = findNestedString(item, keys);
      if (match) {
        return match;
      }
    }
    return "";
  }
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  for (const value of Object.values(data)) {
    const match = findNestedString(value, keys);
    if (match) {
      return match;
    }
  }
  return "";
}

function collectTextSources(value, bucket = []) {
  const append = (text) => {
    let cleaned = text.trim().replace(/\s+/g, " ");
    if (!cleaned) {
      return;
    }
    if (cleaned.length > 4000) {
      cleaned = cleaned.slice(0, 4000).trimEnd();
    }
    if (!bucket.includes(cleaned)) {
      bucket.push(cleaned);
    }
  };
  if (typeof value === "string") {
    append(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (bucket.length >= 12) {
        break;
      }
      collectTextSources(item, bucket);
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (bucket.length >= 12) {
        break;
      }
      if (typeof item === "string") {
        if (PREFERRED_TEXT_KEYS.some((token) => key.toLowerCase().includes(token)) || item.trim().length >= 24) {
          append(item);
        }
      } else {
        collectTextSources(item, bucket);
      }
    }
  }
  return bucket.slice(0, 12);
}

function buildAutoCaptureSignature(toolName, eventType, snapshot, payload) {
  const payloadFingerprint = {};
  for (const key of ["type", "eventType", "event_type", "id", "session_id", "sessionId"]) {
    if (typeof payload[key] === "string" && payload[key].trim()) {
      payloadFingerprint[key] = payload[key].trim();
    }
  }
  return crypto
    .createHash("sha256")
    .update(
      jsonDumps({
        tool: toolName,
        eventType,
        payload: payloadFingerprint,
        textSources: collectTextSources(payload).slice(0, 4),
        worktreeFiles: snapshot.worktreeFiles ?? [],
        worktreeDiff: snapshot.worktreeDiff ?? "",
      }),
      "utf8",
    )
    .digest("hex");
}

function loadAutoCaptureState(repoRoot) {
  const state = readJson(path.join(repoRoot, AUTO_CAPTURE_STATE_PATH));
  return state && typeof state === "object" ? state : { lastByTool: {} };
}

function saveAutoCaptureState(repoRoot, state) {
  writeJson(path.join(repoRoot, AUTO_CAPTURE_STATE_PATH), state);
}

function shouldSkipCapture(repoRoot, toolName, signature, snapshot, payload, transcriptPath) {
  const state = loadAutoCaptureState(repoRoot);
  const lastByTool = state.lastByTool && typeof state.lastByTool === "object" ? state.lastByTool : {};
  state.lastByTool = lastByTool;
  if (lastByTool[toolName] === signature) {
    return [true, "duplicate"];
  }
  const hasFiles = Array.isArray(snapshot.worktreeFiles) && snapshot.worktreeFiles.length > 0;
  const hasDiff = Boolean(String(snapshot.worktreeDiff ?? "").trim());
  const hasPayloadText = collectTextSources(payload).length > 0;
  const hasTranscript = Boolean(transcriptPath.trim());
  if (!hasFiles && !hasDiff && !hasPayloadText && !hasTranscript) {
    return [true, "empty"];
  }
  lastByTool[toolName] = signature;
  saveAutoCaptureState(repoRoot, state);
  return [false, ""];
}

function buildAutoCapturePayload(toolName, eventType, files, payload) {
  const explicitSummary = getStringValue(payload, "summary");
  if (explicitSummary) {
    let knowledge = extractDeferredKnowledge(collectTextSources(payload));
    let candidateSpec = extractDeferredCandidateSpec(collectTextSources(payload));
    if (Array.isArray(payload.knowledge)) {
      knowledge = payload.knowledge.filter((item) => typeof item === "string");
    }
    const candidateValue = payload.candidate_spec ?? payload.candidateSpec ?? [];
    if (Array.isArray(candidateValue)) {
      candidateSpec = candidateValue.filter((item) => typeof item === "string");
    }
    return {
      summary: explicitSummary,
      knowledge,
      candidate_spec: candidateSpec,
    };
  }
  const textSources = collectTextSources(payload);
  const firstSource = textSources[0] ?? "";
  let summary = summarizeDeferredContext(firstSource, "", files);
  if (!firstSource) {
    const label = `${toolName.slice(0, 1).toUpperCase()}${toolName.slice(1)}`;
    summary = `Automatic Memraft capture from ${label}${eventType ? ` (${eventType})` : ""}.`;
    if (files.length > 0) {
      summary = `${summary} Files touched: ${files.slice(0, 5).join(", ")}.`;
    }
  }
  return {
    summary,
    knowledge: extractDeferredKnowledge(textSources),
    candidate_spec: extractDeferredCandidateSpec(textSources),
  };
}

export async function mainSessionStart() {
  if (process.env.CLAUDE_NON_INTERACTIVE === "1") {
    return 0;
  }
  const inputData = readStdinJson();
  const repoRoot = resolveHookRepoRoot(inputData);
  ensureCompiledArtifacts(repoRoot);
  const config = loadConfig(repoRoot);
  const context = readText(
    getArtifactPath(repoRoot, config, "sessionStartInjectionPath", "generated/inject/session-start.txt"),
    "",
  ).trim();
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
  return 0;
}

export async function mainPreToolUse() {
  const inputData = readStdinJson();
  if (!["Task", "Agent"].includes(String(inputData.tool_name ?? ""))) {
    return 0;
  }
  const toolInput = inputData.tool_input;
  if (!toolInput || typeof toolInput !== "object" || typeof toolInput.prompt !== "string" || !toolInput.prompt.trim()) {
    return 0;
  }
  const repoRoot = resolveHookRepoRoot(inputData);
  ensureCompiledArtifacts(repoRoot);
  const config = loadConfig(repoRoot);
  const context = readText(getArtifactPath(repoRoot, config, "toolInjectionPath", "generated/inject/tool-task.txt"), "").trim();
  if (!context) {
    return 0;
  }
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: {
          ...toolInput,
          prompt: `<memraft-shared-context>\n${context}\n</memraft-shared-context>\n\n${toolInput.prompt}`,
        },
      },
    }),
  );
  return 0;
}

export async function mainGeminiBeforeAgent() {
  const inputData = readStdinJson();
  if (typeof inputData.prompt !== "string" || !inputData.prompt.trim()) {
    return 0;
  }
  const repoRoot = resolveHookRepoRoot(inputData);
  ensureCompiledArtifacts(repoRoot);
  const config = loadConfig(repoRoot);
  const context = readText(getArtifactPath(repoRoot, config, "toolInjectionPath", "generated/inject/tool-task.txt"), "").trim();
  if (!context) {
    return 0;
  }
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "BeforeAgent",
        additionalContext: context,
      },
    }),
  );
  return 0;
}

export async function mainStop() {
  const inputData = readStdinJson();
  const repoRoot = resolveHookRepoRoot(inputData);
  const config = loadConfig(repoRoot);
  const stopConfig = getStopSummaryConfig(config);
  const approve = () => console.log(JSON.stringify({ decision: "approve" }));
  const block = (reason) => console.log(JSON.stringify({ decision: "block", reason }));
  if (!stopConfig.enabled) {
    approve();
    return 0;
  }
  const lastMessage = getLastAssistantMessage(inputData).trim();
  if (!lastMessage) {
    approve();
    return 0;
  }
  const captureConfig = getCaptureConfig(config);
  const snapshot = buildCaptureSnapshot(repoRoot, captureConfig);
  const files = Array.isArray(snapshot.worktreeFiles) ? snapshot.worktreeFiles : [];
  const sessionId = getSessionId(inputData);
  const request = buildSummaryRequest(inputData, repoRoot, stopConfig, snapshot);
  const state = loadSummaryState(repoRoot);
  const existing = findRequestByMessageFingerprint(state, sessionId, String(request.messageFingerprint));
  if (existing) {
    const status = String(existing.status ?? "");
    if (status === "completed") {
      approve();
      return 0;
    }
    if (["pending", "running"].includes(status)) {
      if (getStopHookActive(inputData)) {
        const blockCount = Number.isInteger(existing.blockCount) ? existing.blockCount : 0;
        if (blockCount >= stopConfig.maxBlockAttempts) {
          existing.status = "expired";
          existing.updatedAt = String(request.createdAt);
          saveSummaryState(repoRoot, state);
          approve();
          return 0;
        }
      }
      existing.blockCount = (Number.isInteger(existing.blockCount) ? existing.blockCount : 0) + 1;
      existing.updatedAt = String(request.createdAt);
      saveSummaryState(repoRoot, state);
      block(buildStopReason(existing, stopConfig));
      return 0;
    }
    approve();
    return 0;
  }
  if (getStopHookActive(inputData) || !shouldRequestStopSummary(stopConfig, files, lastMessage)) {
    approve();
    return 0;
  }
  request.blockCount = 1;
  state.requests[String(request.requestId)] = request;
  saveSummaryState(repoRoot, state);
  block(buildStopReason(request, stopConfig));
  return 0;
}

export async function mainSubagentStart() {
  const inputData = readStdinJson();
  const repoRoot = resolveHookRepoRoot(inputData);
  const config = loadConfig(repoRoot);
  const stopConfig = getStopSummaryConfig(config);
  const subagentType = getAgentType(inputData);
  const subagentId = getAgentId(inputData);
  const sessionId = getSessionId(inputData);
  const parts = [];
  ensureCompiledArtifacts(repoRoot);
  const sharedContext = readText(
    getArtifactPath(repoRoot, config, "subagentInjectionPath", "generated/inject/subagent.txt"),
    "",
  ).trim();
  if (sharedContext) {
    parts.push(sharedContext);
  }
  if (subagentType === String(stopConfig.agentName)) {
    const state = loadSummaryState(repoRoot);
    const requests = listSummaryRequests(state, { sessionId, statuses: new Set(["pending", "running"]) });
    if (requests.length > 0) {
      const request = requests[0];
      if (subagentId) {
        request.agentId = subagentId;
      }
      request.status = "running";
      request.updatedAt = nowIso();
      saveSummaryState(repoRoot, state);
      const requestId = String(request.requestId ?? "unknown");
      const assistantExcerpt = String(request.assistantMessageExcerpt ?? "").trim();
      const files = Array.isArray(request.filesSnapshot) ? request.filesSnapshot : [];
      const lines = [
        "<memraft-summary-request>",
        `summary_request_id: ${requestId}`,
        "Return strict JSON only with keys `summary`, `knowledge`, and `candidate_spec`.",
        "",
      ];
      if (assistantExcerpt) {
        lines.push("Last assistant message excerpt:", assistantExcerpt, "");
      }
      const fileLines = files.filter((item) => typeof item === "string" && item).map((item) => `- ${item}`);
      if (fileLines.length > 0) {
        lines.push("Relevant changed files:", ...fileLines, "");
      }
      lines.push("</memraft-summary-request>");
      parts.push(lines.join("\n"));
    }
  }
  if (parts.length === 0) {
    return 0;
  }
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: parts.join("\n\n").trim(),
      },
    }),
  );
  return 0;
}

export async function mainSubagentStop() {
  const inputData = readStdinJson();
  const repoRoot = resolveHookRepoRoot(inputData);
  const config = loadConfig(repoRoot);
  const stopConfig = getStopSummaryConfig(config);
  const subagentType = getAgentType(inputData);
  if (subagentType !== String(stopConfig.agentName)) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return 0;
  }
  const state = loadSummaryState(repoRoot);
  const request =
    findRequestByAgentId(state, getAgentId(inputData)) ??
    listSummaryRequests(state, {
      sessionId: getSessionId(inputData),
      statuses: new Set(["pending", "running"]),
    })[0] ??
    null;
  if (!request) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return 0;
  }
  const payload = extractJson(getLastAssistantMessage(inputData));
  request.updatedAt = nowIso();
  if (!payload) {
    request.status = "failed";
    request.failureReason = "Subagent output did not contain valid JSON.";
    saveSummaryState(repoRoot, state);
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return 0;
  }
  const event = request.event && typeof request.event === "object" ? request.event : null;
  if (!event) {
    request.status = "failed";
    request.failureReason = "Missing Memraft summary request event.";
    saveSummaryState(repoRoot, state);
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return 0;
  }
  const evidence = persistSummary(repoRoot, event, payload, String(stopConfig.agentName), {
    stopSummary: true,
    summaryRequestId: request.requestId,
    assistantMessageChars: request.assistantMessageChars,
    subagentType,
    agentId: getAgentId(inputData),
  });
  request.status = "completed";
  request.completedAt = nowIso();
  request.updatedAt = request.completedAt;
  request.evidenceEventId = evidence.eventId;
  saveSummaryState(repoRoot, state);
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  return 0;
}

export async function mainManualCapture(argv = process.argv.slice(2)) {
  const flags = parseFlagArgs(argv);
  const toolMap = {
    claude: "claude-code",
    "claude-code": "claude-code",
    codex: "codex",
    gemini: "gemini-cli",
    "gemini-cli": "gemini-cli",
    opencode: "opencode",
  };
  const toolName = toolMap[String(flags.tool ?? "").trim().toLowerCase()] ?? String(flags.tool ?? "").trim().toLowerCase();
  if (!["claude-code", "codex", "gemini-cli", "opencode"].includes(toolName)) {
    console.error(JSON.stringify({ ok: false, error: `Unsupported Memraft tool: ${String(flags.tool ?? "")}` }));
    return 1;
  }
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    console.error(JSON.stringify({ ok: false, error: "Project memory manual capture expects a JSON payload on stdin with keys `summary`, `knowledge`, and `candidate_spec`." }));
    return 1;
  }
  const payload = extractJson(raw);
  if (!payload) {
    console.error(JSON.stringify({ ok: false, error: "Project memory manual capture could not parse JSON from stdin. Return strict JSON only." }));
    return 1;
  }
  const repoRoot = findRepoRoot();
  const config = loadConfig(repoRoot);
  const captureConfig = getCaptureConfig(config);
  const snapshot = buildCaptureSnapshot(repoRoot, captureConfig);
  const event = buildEvent(
    {
      session_id: typeof flags["session-id"] === "string" && flags["session-id"] ? flags["session-id"] : `${toolName}-manual`,
      reason: typeof flags.reason === "string" && flags.reason ? flags.reason : `manual_capture:${toolName}`,
      transcript_path: typeof flags["transcript-path"] === "string" ? flags["transcript-path"] : "",
    },
    repoRoot,
    { eventKind: "manual_capture", snapshot },
  );
  const evidence = persistSummary(repoRoot, event, payload, `${toolName}-manual`, {
    manualCapture: true,
    captureTool: toolName,
  });
  console.log(JSON.stringify({ ok: true, eventId: evidence.eventId, generator: evidence.generator, quality: evidence.quality, merge: evidence.merge }));
  return 0;
}

export async function mainAutoCapture(argv = process.argv.slice(2)) {
  const flags = parseFlagArgs(argv);
  const toolName = String(flags.tool ?? "").trim().toLowerCase();
  if (!["codex", "opencode"].includes(toolName)) {
    console.log(JSON.stringify({ ok: false, error: `Unsupported Memraft tool: ${String(flags.tool ?? "")}` }));
    return 1;
  }
  const rawCandidates = [];
  try {
    const stdinRaw = fs.readFileSync(0, "utf8").trim();
    if (stdinRaw) {
      rawCandidates.push(stdinRaw);
    }
  } catch {}
  rawCandidates.push(...flags._.filter((item) => typeof item === "string" && item.trim()));
  let payload = {};
  for (const candidate of rawCandidates) {
    const parsed = extractJson(candidate);
    if (parsed) {
      payload = parsed;
      break;
    }
  }
  const repoRoot = findNestedString(payload, REPO_PATH_KEYS) ? findRepoRoot(findNestedString(payload, REPO_PATH_KEYS)) : findRepoRoot();
  if (!isCaptureEnabled(repoRoot, toolName)) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "capture_disabled" }));
    return 0;
  }
  const config = loadConfig(repoRoot);
  const captureConfig = getCaptureConfig(config);
  const snapshot = buildCaptureSnapshot(repoRoot, captureConfig);
  const eventType =
    String(flags["event-type"] ?? "").trim() ||
    getStringValue(payload, "type", "eventType", "event_type") ||
    (payload.hook_event && typeof payload.hook_event === "object"
      ? getStringValue(payload.hook_event, "event_type", "eventType", "type")
      : "") ||
    (payload.event && typeof payload.event === "object" ? getStringValue(payload.event, "type", "eventType", "event_type") : "");
  const transcriptPath =
    String(flags["transcript-path"] ?? "").trim() || findNestedString(payload, TRANSCRIPT_PATH_KEYS);
  const signature = buildAutoCaptureSignature(toolName, eventType, snapshot, payload);
  const [skip, reason] = shouldSkipCapture(repoRoot, toolName, signature, snapshot, payload, transcriptPath);
  if (skip) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason }));
    return 0;
  }
  const sessionId = String(flags["session-id"] ?? "").trim() || findNestedString(payload, SESSION_ID_KEYS) || `${toolName}-auto`;
  const event = buildEvent(
    { session_id: sessionId, reason: `automatic_capture:${toolName}${eventType ? `:${eventType}` : ""}`, transcript_path: transcriptPath },
    repoRoot,
    { eventKind: "automatic_capture", snapshot },
  );
  const files = Array.isArray(snapshot.worktreeFiles) ? snapshot.worktreeFiles.filter((item) => typeof item === "string" && item) : [];
  const evidence = persistSummary(repoRoot, event, buildAutoCapturePayload(toolName, eventType, files, payload), `${toolName}-auto`, {
    automaticCapture: true,
    captureTool: toolName,
    captureEventType: eventType,
    capturePayloadPresent: Object.keys(payload).length > 0,
  });
  console.log(JSON.stringify({ ok: true, eventId: evidence.eventId, generator: evidence.generator, quality: evidence.quality, merge: evidence.merge, summary: evidence.summary }));
  return 0;
}

export async function mainCodexNotify(argv = process.argv.slice(2)) {
  return mainAutoCapture(["--tool", "codex", ...argv]);
}

function spawnSessionEndWorker(repoRoot, event) {
  const logPath = path.join(repoRoot, MEMRAFT_DIR, "logs", "session-end.log");
  ensureDir(path.dirname(logPath));
  const eventPath = path.join(repoRoot, MEMRAFT_DIR, "state", "session-events", `${String(event.eventId ?? "event")}.json`);
  writeJson(eventPath, event);
  const logFile = fs.openSync(logPath, "a");
  try {
    const child = spawn("node", [path.join(repoRoot, MEMRAFT_DIR, "hooks", "session_end.mjs"), "--worker", "--event-file", eventPath], {
      cwd: repoRoot,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", logFile, logFile],
      env: { ...process.env, MEMRAFT_SESSION_END_WORKER: "1" },
    });
    child.unref();
    return 0;
  } catch {
    fs.writeSync(logFile, "Failed to spawn session-end worker.\n");
    return 1;
  } finally {
    fs.closeSync(logFile);
  }
}

function processSessionEndEvent(repoRoot, event) {
  const config = loadConfig(repoRoot);
  const stopConfig = getStopSummaryConfig(config);
  const captureConfig = getCaptureConfig(config);
  const sessionId = getSessionId(event);
  const state = loadSummaryState(repoRoot);
  const requests = state.requests && typeof state.requests === "object" ? state.requests : {};
  const completedRequests = Object.values(requests).filter(
    (request) => request && typeof request === "object" && String(request.sessionId) === sessionId && String(request.status) === "completed",
  );
  const unresolvedRequests = Object.values(requests).filter(
    (request) =>
      request &&
      typeof request === "object" &&
      String(request.sessionId) === sessionId &&
      new Set(["pending", "running", "failed"]).has(String(request.status)),
  );
  if (completedRequests.length > 0) {
    for (const request of unresolvedRequests) {
      request.status = "expired";
      request.updatedAt = String(event.createdAt);
      request.fallbackEventId = String(event.eventId);
    }
    saveSummaryState(repoRoot, state);
    return 0;
  }
  const latestRequest = unresolvedRequests[0] ?? null;
  if (latestRequest) {
    const deferredEvent = latestRequest.event && typeof latestRequest.event === "object" ? { ...latestRequest.event } : { ...event };
    for (const key of ["transcriptPath", "reason", "repoRoot", "worktreeFiles", "worktreeDiff", "worktreeCapturedAt"]) {
      if (!(key in deferredEvent) && key in event) {
        deferredEvent[key] = event[key];
      }
    }
    const transcriptText = readTranscriptExcerpt(getStringValue(deferredEvent, "transcriptPath"), captureConfig.maxTranscriptChars);
    let files = Array.isArray(deferredEvent.worktreeFiles)
      ? deferredEvent.worktreeFiles.filter((item) => typeof item === "string" && item)
      : [];
    if (files.length === 0) {
      files = buildCaptureSnapshot(repoRoot, captureConfig).worktreeFiles ?? [];
    }
    const evidence = persistSummary(repoRoot, deferredEvent, buildDeferredSummaryPayload(latestRequest, transcriptText, files), "session-end-deferred", {
      sessionEndDeferred: true,
      sessionEndEventId: event.eventId,
      summaryRequestId: latestRequest.requestId,
      stopSummaryAgent: stopConfig.agentName,
      assistantExcerptChars: String(latestRequest.assistantMessageExcerpt ?? "").trim().length,
    });
    const completedAt = String(event.createdAt || evidence.createdAt);
    for (const request of unresolvedRequests) {
      request.updatedAt = completedAt;
      if (request === latestRequest) {
        request.status = "completed";
        request.completedAt = completedAt;
        request.evidenceEventId = evidence.eventId;
        request.completionMode = "session-end-deferred";
      } else {
        request.status = "expired";
        request.fallbackEventId = String(event.eventId);
      }
    }
    saveSummaryState(repoRoot, state);
    return 0;
  }
  let files = Array.isArray(event.worktreeFiles) ? event.worktreeFiles.filter((item) => typeof item === "string" && item) : [];
  if (files.length === 0) {
    files = buildCaptureSnapshot(repoRoot, captureConfig).worktreeFiles ?? [];
  }
  persistSummary(repoRoot, event, fallbackPayload(event, files), "session-end-fallback", {
    sessionEndFallback: true,
    stopSummaryAgent: stopConfig.agentName,
  });
  for (const request of unresolvedRequests) {
    request.status = "expired";
    request.updatedAt = String(event.createdAt);
    request.fallbackEventId = String(event.eventId);
  }
  saveSummaryState(repoRoot, state);
  return 0;
}

export async function mainSessionEnd(argv = process.argv.slice(2)) {
  const flags = parseFlagArgs(argv);
  if (flags.worker) {
    if (typeof flags["event-file"] !== "string" || !flags["event-file"]) {
      return 1;
    }
    const event = readJson(flags["event-file"]);
    if (!event) {
      return 1;
    }
    const repoRoot =
      typeof event.repoRoot === "string" && event.repoRoot ? findRepoRoot(event.repoRoot) : findRepoRoot();
    const result = processSessionEndEvent(repoRoot, event);
    if (result === 0) {
      try {
        fs.unlinkSync(flags["event-file"]);
      } catch {}
    }
    return result;
  }
  const inputData = readStdinJson();
  const repoRoot = resolveHookRepoRoot(inputData);
  const config = loadConfig(repoRoot);
  const captureConfig = getCaptureConfig(config);
  const snapshot = buildCaptureSnapshot(repoRoot, captureConfig);
  const event = buildEvent(inputData, repoRoot, { eventKind: "session_end_fallback", snapshot });
  return spawnSessionEndWorker(repoRoot, event);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export async function mainMemraftCli(argv = process.argv.slice(2)) {
  const args = [...argv];
  const repoRoot = findRepoRoot();
  if (args[0] === "recall") {
    const query = args[1] ?? "";
    const flags = parseFlagArgs(args.slice(2));
    const payload = recall(repoRoot, query, {
      scope: String(flags.scope ?? "").trim(),
      taskId: String(flags.task ?? "").trim(),
      limit: Math.max(1, Number.parseInt(String(flags.limit ?? "10"), 10) || 10),
    });
    if (flags.json) {
      printJson(payload);
    } else {
      console.log("Memraft Recall\n");
      console.log(`Query: ${payload.query}`);
    }
    return 0;
  }
  if (args[0] === "task") {
    const subcommand = args[1];
    const flags = parseFlagArgs(args.slice(2));
    const createdAt = nowIso();
    let payload = null;
    if (subcommand === "create") {
      payload = createTask(repoRoot, args[2] ?? "", String(flags.slug ?? ""), createdAt);
    } else if (subcommand === "start") {
      payload = startTask(repoRoot, args[2] ?? "", createdAt);
    } else if (subcommand === "finish") {
      payload = finishTask(repoRoot, args[2] ?? "", createdAt);
    } else if (subcommand === "show") {
      payload = showTask(repoRoot, args[2] ?? "");
    }
    if (!payload) {
      console.error(JSON.stringify({ ok: false, error: "Task not found" }));
      return 1;
    }
    writeRuntimeSummary(repoRoot);
    if (flags.json) {
      printJson(payload);
    } else {
      console.log("Memraft Task\n");
      console.log(`Task: ${payload.taskId}`);
    }
    return 0;
  }
  if (args[0] === "promote") {
    const flags = parseFlagArgs(args.slice(2));
    const payload = promoteMemory(repoRoot, args[1] ?? "", nowIso());
    if (!payload) {
      console.error(JSON.stringify({ ok: false, error: "Memory not found" }));
      return 1;
    }
    const config = loadConfig(repoRoot);
    const mergeIndex = loadMergeIndexDb(repoRoot);
    writeMergeOutputs(repoRoot, config, mergeIndex, getPromotionRules(config));
    writeCompiledOutputs(repoRoot, config, mergeIndex);
    if (flags.json) {
      printJson(payload);
    } else {
      console.log(`Promoted ${payload.memoryId} -> ${payload.promotedCollection}`);
    }
    return 0;
  }
  if (args[0] === "inspect") {
    const subcommand = args[1];
    const flags = parseFlagArgs(args.slice(2));
    if (subcommand === "pending") {
      const payload = listPendingMemories(repoRoot);
      flags.json ? printJson(payload) : console.log(`Pending Promotions\n\n${payload.length === 0 ? "- none" : payload.map((item) => `- ${item.memoryId}`).join("\n")}`);
      return 0;
    }
    if (subcommand === "latest") {
      const payload = loadLatestEvidenceDb(repoRoot);
      if (!payload || Object.keys(payload).length === 0) {
        console.error(JSON.stringify({ ok: false, error: "No latest evidence found" }));
        return 1;
      }
      flags.json ? printJson(payload) : console.log(`Latest Evidence\n\nEvent: ${payload.eventId}`);
      return 0;
    }
    if (subcommand === "rules") {
      const ruleStore = buildRuleStore(repoRoot);
      const payload = { repoRoot, ruleStorePath: getDbPath(repoRoot), ruleStore };
      flags.json ? printJson(payload) : console.log("Rule Store");
      return 0;
    }
    if (subcommand === "lineage") {
      try {
        const payload = { repoRoot, ...resolveLineageRecord(repoRoot, String(args[2] ?? "").trim()) };
        flags.json ? printJson(payload) : console.log("Rule Lineage");
        return 0;
      } catch (error) {
        console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return 1;
      }
    }
    const payload = buildRuntimeSummary(repoRoot);
    flags.json ? printJson(payload) : console.log("Memraft Runtime");
    return 0;
  }
  const activeTask = getActiveTask(repoRoot);
  if (activeTask) {
    printJson(activeTask);
  }
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  return mainAutoCapture(argv);
}
