import {
  countRuntimeFiles,
  loadSqliteSnapshot,
  readJsonIfExists,
  requireInitialized,
  summarizeSharedSpec,
  summarizeHooks,
} from "./runtime.js";
import fs from "node:fs";

export async function printStatus(options = {}) {
  const paths = requireInitialized(options.targetDir);
  const config = readJsonIfExists(paths.configPath) ?? {};
  const repoProfile = readJsonIfExists(paths.repoProfilePath);
  const sqliteSnapshot = loadSqliteSnapshot(paths.repoRoot);
  const latest = sqliteSnapshot.latest;
  const runtimeSummary = sqliteSnapshot.runtime;
  const collectionSummaries =
    sqliteSnapshot.collections && typeof sqliteSnapshot.collections === "object"
      ? sqliteSnapshot.collections
      : {};
  const hooks = summarizeHooks(paths.repoRoot);
  const pendingEvents = countRuntimeFiles(paths.sessionEventsDir);
  const outboxEntries = countRuntimeFiles(paths.syncOutboxDir);
  const sharedSpec = summarizeSharedSpec(paths.repoRoot);

  const knowledge =
    collectionSummaries.knowledge && typeof collectionSummaries.knowledge === "object"
      ? collectionSummaries.knowledge
      : { total: 0, promoted: 0, candidates: 0, invalidated: 0 };
  const candidateSpec =
    collectionSummaries.candidateSpec && typeof collectionSummaries.candidateSpec === "object"
      ? collectionSummaries.candidateSpec
      : { total: 0, promoted: 0, candidates: 0, invalidated: 0 };
  const projectName =
    typeof config.projectName === "string" && config.projectName
      ? config.projectName
      : paths.repoRoot.split("/").filter(Boolean).at(-1) ?? "repo";
  const nextAction =
    knowledge.promoted + candidateSpec.promoted > 0 &&
    sharedSpec.acceptedEntries === 0
      ? "Review promoted local knowledge with `memraft inspect proposals` and accept shared entries into memraft/spec."
      : "";

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          repoRoot: paths.repoRoot,
          projectName,
          hooks,
          pendingEvents,
          outboxEntries,
          knowledge,
          candidateSpec,
          sharedSpec,
          nextAction,
          generated: {
            repoProfile: Boolean(repoProfile),
            ruleStore: fs.existsSync(paths.ruleStorePath),
            compiledSpec: fs.existsSync(paths.compiledSpecPath),
            compiledState: fs.existsSync(paths.compiledStatePath),
            runtimeSummary: fs.existsSync(paths.runtimeSummaryPath),
            sqlite: fs.existsSync(paths.sqlitePath),
            sessionStartInjection: fs.existsSync(paths.sessionStartInjectionPath),
            toolInjection: fs.existsSync(paths.toolInjectionPath),
            subagentInjection: fs.existsSync(paths.subagentInjectionPath),
            adapterManifest: fs.existsSync(paths.adapterManifestPath),
            codexAgents: fs.existsSync(paths.codexAgentsPath),
            codexConfig: fs.existsSync(paths.codexConfigPath),
            codexHooks: fs.existsSync(paths.codexHooksPath),
            geminiContext: fs.existsSync(paths.geminiContextPath),
            opencodeAgents: fs.existsSync(paths.opencodeAgentsPath),
            opencodeConfig: fs.existsSync(paths.opencodeConfigPath),
            opencodePlugin: fs.existsSync(paths.opencodePluginPath),
            nativeAgents: fs.existsSync(paths.nativeAgentsPath),
            nativeCodexConfig: fs.existsSync(paths.nativeCodexConfigPath),
            nativeCodexHooks: fs.existsSync(paths.nativeCodexHooksPath),
            nativeGemini: fs.existsSync(paths.nativeGeminiPath),
            nativeOpencodeConfig: fs.existsSync(paths.nativeOpencodeConfigPath),
            nativeOpencodePlugin: fs.existsSync(paths.nativeOpencodePluginPath),
          },
          runtime: runtimeSummary,
          latestEvidence: latest,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("Memraft Status");
  console.log("");
  console.log(`Repo: ${paths.repoRoot}`);
  console.log(`Project: ${projectName}`);
  console.log(`Initialized: yes`);
  console.log("");
  console.log("Hooks:");
  console.log(`- SessionStart: ${hooks.sessionStart ? "ok" : "missing"}`);
  console.log(`- PreToolUse: ${hooks.preToolUse ? "ok" : "missing"}`);
  console.log(`- Stop: ${hooks.stop ? "ok" : "missing"}`);
  console.log(`- SubagentStart: ${hooks.subagentStart ? "ok" : "missing"}`);
  console.log(`- SubagentStop: ${hooks.subagentStop ? "ok" : "missing"}`);
  console.log(`- SessionEnd: ${hooks.sessionEnd ? "ok" : "missing"}`);
  console.log(`- pending worker events: ${pendingEvents}`);
  console.log(`- sync outbox entries: ${outboxEntries}`);
  console.log("");
  console.log("Knowledge:");
  console.log(
    `- memory: total=${knowledge.total}, promoted=${knowledge.promoted}, candidates=${knowledge.candidates}, invalidated=${knowledge.invalidated}`,
  );
  console.log(
    `- candidate spec: total=${candidateSpec.total}, promoted=${candidateSpec.promoted}, candidates=${candidateSpec.candidates}, invalidated=${candidateSpec.invalidated}`,
  );
  console.log("");
  console.log("Shared Spec:");
  console.log(`- root: ${sharedSpec.rootDir}`);
  console.log(`- accepted entries: ${sharedSpec.acceptedEntries}`);
  console.log(
    `- files: background=${sharedSpec.sections.background.exists ? "ok" : "missing"}, conventions=${sharedSpec.sections.conventions.exists ? "ok" : "missing"}, workflows=${sharedSpec.sections.workflows.exists ? "ok" : "missing"}`,
  );
  console.log("");
  console.log("Generated:");
  console.log(`- repo profile: ${repoProfile ? "ok" : "missing"}`);
  console.log(`- rule store: ${fs.existsSync(paths.ruleStorePath) ? "ok" : "missing"}`);
  console.log(`- compiled spec: ${fs.existsSync(paths.compiledSpecPath) ? "ok" : "missing"}`);
  console.log(`- compiled state: ${fs.existsSync(paths.compiledStatePath) ? "ok" : "missing"}`);
  console.log(
    `- runtime: summary=${fs.existsSync(paths.runtimeSummaryPath) ? "ok" : "missing"}, sqlite=${fs.existsSync(paths.sqlitePath) ? "ok" : "missing"}`,
  );
  console.log(
    `- injections: session=${fs.existsSync(paths.sessionStartInjectionPath) ? "ok" : "missing"}, tool=${fs.existsSync(paths.toolInjectionPath) ? "ok" : "missing"}, subagent=${fs.existsSync(paths.subagentInjectionPath) ? "ok" : "missing"}`,
  );
  console.log(
    `- adapters: manifest=${fs.existsSync(paths.adapterManifestPath) ? "ok" : "missing"}, codex=${fs.existsSync(paths.codexAgentsPath) ? "ok" : "missing"}, codex-config=${fs.existsSync(paths.codexConfigPath) ? "ok" : "missing"}, codex-hooks=${fs.existsSync(paths.codexHooksPath) ? "ok" : "missing"}, gemini=${fs.existsSync(paths.geminiContextPath) ? "ok" : "missing"}, opencode=${fs.existsSync(paths.opencodeAgentsPath) ? "ok" : "missing"}, opencode-config=${fs.existsSync(paths.opencodeConfigPath) ? "ok" : "missing"}, opencode-plugin=${fs.existsSync(paths.opencodePluginPath) ? "ok" : "missing"}`,
  );
  console.log(
    `- installed entrypoints: AGENTS=${fs.existsSync(paths.nativeAgentsPath) ? "ok" : "missing"}, .codex/config.toml=${fs.existsSync(paths.nativeCodexConfigPath) ? "ok" : "missing"}, .codex/hooks.json=${fs.existsSync(paths.nativeCodexHooksPath) ? "ok" : "missing"}, GEMINI=${fs.existsSync(paths.nativeGeminiPath) ? "ok" : "missing"}, opencode.json=${fs.existsSync(paths.nativeOpencodeConfigPath) ? "ok" : "missing"}, .opencode/plugins/memraft-auto-capture.js=${fs.existsSync(paths.nativeOpencodePluginPath) ? "ok" : "missing"}`,
  );
  console.log("");

  if (runtimeSummary && typeof runtimeSummary === "object") {
    const activeTask =
      runtimeSummary.activeTask && typeof runtimeSummary.activeTask === "object"
        ? runtimeSummary.activeTask
        : null;
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
    console.log(`- events: ${runtimeSummary.eventCount ?? 0}`);
    console.log(`- memories: ${runtimeSummary.memoryCount ?? 0}`);
    console.log(`- memory edges: ${runtimeSummary.memoryEdgeCount ?? 0}`);
    console.log(
      `- active task: ${activeTask ? activeTask.title ?? activeTask.task_id ?? activeTask.taskId ?? "unknown" : "none"}`,
    );
    console.log(`- adapters tracked: ${Object.keys(adapterStates).length}`);
    for (const [name, state] of Object.entries(adapterStates)) {
      if (!state || typeof state !== "object") {
        continue;
      }
      console.log(`- adapter ${name}: ${state.ownership ?? "unknown"}`);
    }
    for (const [name, state] of Object.entries(adapterModes)) {
      if (!state || typeof state !== "object") {
        continue;
      }
      console.log(`- mode ${name}: ${state.mode ?? "unknown"}`);
    }
    console.log("");
  }

  if (!latest) {
    console.log("Latest evidence:");
    console.log("- none yet");
    if (nextAction) {
      console.log("");
      console.log(`Next: ${nextAction}`);
    }
    return;
  }

  const quality =
    latest.quality && typeof latest.quality === "object" ? latest.quality : {};
  const grade =
    typeof quality.grade === "string" && quality.grade ? quality.grade : "N/A";
  const score = Number.isFinite(quality.score) ? quality.score : "N/A";
  const summary =
    typeof latest.summary === "string" && latest.summary
      ? latest.summary
      : "(empty)";
  const files = Array.isArray(latest.files) ? latest.files : [];

  console.log("Latest evidence:");
  console.log(`- event: ${latest.eventId ?? "unknown"}`);
  console.log(`- createdAt: ${latest.createdAt ?? "unknown"}`);
  console.log(`- grade: ${grade}`);
  console.log(`- score: ${score}`);
  console.log(`- files: ${files.length}`);
  console.log(`- summary: ${summary}`);

  if (nextAction) {
    console.log("");
    console.log(`Next: ${nextAction}`);
  }
}
