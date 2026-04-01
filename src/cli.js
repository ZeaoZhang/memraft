import {
  inspectCompiled,
  inspectLatest,
  inspectLineage,
  inspectRules,
} from "./inspect.js";
import { initTeamai } from "./init.js";
import { printStatus } from "./status.js";

function printHelp() {
  console.log(`TeamAI Local MVP

Usage:
  teamai-local init [target-dir] [--force] [--skip-existing]
  teamai-local status [target-dir]
  teamai-local inspect latest [target-dir] [--json]
  teamai-local inspect rules [target-dir] [--json]
  teamai-local inspect compiled [target-dir] [--json]
  teamai-local inspect lineage <fingerprint> [target-dir] [--json]
  node ./bin/teamai-local.js init [target-dir] [--force] [--skip-existing]

Commands:
  init              Initialize TeamAI hooks and local memory scaffold
  status            Show TeamAI runtime status for a repository
  inspect latest    Show the latest extracted evidence snapshot
  inspect rules     Show the current structured rule store
  inspect compiled  Show compiled outputs and adapter artifacts
  inspect lineage   Show rule lineage for a fingerprint

Options:
  --force           Overwrite existing TeamAI template files
  --skip-existing   Preserve existing TeamAI template files
  --json            Print raw JSON when supported
  -h, --help        Show help
`);
}

function parseInitArgs(args) {
  let targetDir = process.cwd();
  let force = false;
  let skipExisting = false;

  for (const arg of args) {
    if (arg === "--force") {
      force = true;
      continue;
    }

    if (arg === "--skip-existing") {
      skipExisting = true;
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }

    targetDir = arg;
  }

  return { help: false, targetDir, force, skipExisting };
}

function parseTargetArgs(args) {
  let targetDir = process.cwd();
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }

    targetDir = arg;
  }

  return { help: false, targetDir, json };
}

function parseInspectArgs(args, { requiresIdentifier = false } = {}) {
  const positionals = [];
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
    positionals.push(arg);
  }

  if (!requiresIdentifier) {
    return {
      help: false,
      json,
      targetDir: positionals[0] ?? process.cwd(),
    };
  }

  return {
    help: false,
    json,
    fingerprint: positionals[0] ?? "",
    targetDir: positionals[1] ?? process.cwd(),
  };
}

export async function main(args) {
  const [command, ...rest] = args;

  if (!command || command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "init") {
    const options = parseInitArgs(rest);
    if (options.help) {
      printHelp();
      return;
    }

    await initTeamai(options);
    return;
  }

  if (command === "status") {
    const options = parseTargetArgs(rest);
    if (options.help) {
      printHelp();
      return;
    }

    await printStatus(options);
    return;
  }

  if (command === "inspect") {
    const [subject, ...inspectRest] = rest;
    if (subject === "latest") {
      const options = parseInspectArgs(inspectRest);
      if (options.help) {
        printHelp();
        return;
      }
      await inspectLatest(options);
      return;
    }

    if (subject === "rules") {
      const options = parseInspectArgs(inspectRest);
      if (options.help) {
        printHelp();
        return;
      }
      await inspectRules(options);
      return;
    }

    if (subject === "compiled") {
      const options = parseInspectArgs(inspectRest);
      if (options.help) {
        printHelp();
        return;
      }
      await inspectCompiled(options);
      return;
    }

    if (subject === "lineage") {
      const options = parseInspectArgs(inspectRest, { requiresIdentifier: true });
      if (options.help) {
        printHelp();
        return;
      }
      await inspectLineage(options);
      return;
    }

    if (subject !== "latest") {
      printHelp();
      throw new Error(`Unknown inspect target: ${subject ?? "(missing)"}`);
    }
  }

  printHelp();
  throw new Error(`Unknown command: ${command}`);
}
