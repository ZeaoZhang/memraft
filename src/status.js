import {
  countRuntimeFiles,
  readJsonIfExists,
  requireInitialized,
  summarizeCollection,
  summarizeHooks,
  loadMergeIndex,
} from "./runtime.js";
import fs from "node:fs";

export async function printStatus(options = {}) {
  const paths = requireInitialized(options.targetDir);
  const config = readJsonIfExists(paths.configPath) ?? {};
  const latest = readJsonIfExists(paths.latestEvidencePath);
  const repoProfile = readJsonIfExists(paths.repoProfilePath);
  const mergeIndex = loadMergeIndex(paths.repoRoot);
  const hooks = summarizeHooks(paths.repoRoot);
  const pendingEvents = countRuntimeFiles(paths.sessionEventsDir);
  const outboxEntries = countRuntimeFiles(paths.syncOutboxDir);

  const knowledge = summarizeCollection(mergeIndex.knowledge);
  const candidateSpec = summarizeCollection(mergeIndex.candidateSpec);
  const projectName =
    typeof config.projectName === "string" && config.projectName
      ? config.projectName
      : paths.repoRoot.split("/").filter(Boolean).at(-1) ?? "repo";

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
          generated: {
            repoProfile: Boolean(repoProfile),
            ruleStore: fs.existsSync(paths.ruleStorePath),
            compiledSpec: fs.existsSync(paths.compiledSpecPath),
            compiledState: fs.existsSync(paths.compiledStatePath),
            sessionStartInjection: fs.existsSync(paths.sessionStartInjectionPath),
            toolInjection: fs.existsSync(paths.toolInjectionPath),
            subagentInjection: fs.existsSync(paths.subagentInjectionPath),
            adapterManifest: fs.existsSync(paths.adapterManifestPath),
            codexAgents: fs.existsSync(paths.codexAgentsPath),
            geminiContext: fs.existsSync(paths.geminiContextPath),
            opencodeAgents: fs.existsSync(paths.opencodeAgentsPath),
            opencodeConfig: fs.existsSync(paths.opencodeConfigPath),
          },
          latestEvidence: latest,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("TeamAI Status");
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
  console.log("Generated:");
  console.log(`- repo profile: ${repoProfile ? "ok" : "missing"}`);
  console.log(`- rule store: ${fs.existsSync(paths.ruleStorePath) ? "ok" : "missing"}`);
  console.log(`- compiled spec: ${fs.existsSync(paths.compiledSpecPath) ? "ok" : "missing"}`);
  console.log(`- compiled state: ${fs.existsSync(paths.compiledStatePath) ? "ok" : "missing"}`);
  console.log(
    `- injections: session=${fs.existsSync(paths.sessionStartInjectionPath) ? "ok" : "missing"}, tool=${fs.existsSync(paths.toolInjectionPath) ? "ok" : "missing"}, subagent=${fs.existsSync(paths.subagentInjectionPath) ? "ok" : "missing"}`,
  );
  console.log(
    `- adapters: manifest=${fs.existsSync(paths.adapterManifestPath) ? "ok" : "missing"}, codex=${fs.existsSync(paths.codexAgentsPath) ? "ok" : "missing"}, gemini=${fs.existsSync(paths.geminiContextPath) ? "ok" : "missing"}, opencode=${fs.existsSync(paths.opencodeAgentsPath) ? "ok" : "missing"}`,
  );
  console.log("");

  if (!latest) {
    console.log("Latest evidence:");
    console.log("- none yet");
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
}
