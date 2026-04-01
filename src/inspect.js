import { readJsonIfExists, requireInitialized } from "./runtime.js";

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
