import { spawnSync } from "node:child_process";
import {
  inspectCompiled,
} from "./inspect.js";
import { initMemraft } from "./init.js";
import { requireInitialized } from "./runtime.js";
import { printStatus } from "./status.js";

function printHelp() {
  console.log(`Memraft

Usage:
  memraft init [target-dir] [--force] [--skip-existing]
  memraft status [target-dir]
  memraft recall <query> [target-dir] [--scope <scope>] [--task <task-id>] [--limit <n>] [--json]
  memraft task create <title> [target-dir] [--slug <slug>] [--json]
  memraft task start <task-id> [target-dir] [--json]
  memraft task finish <task-id> [target-dir] [--json]
  memraft task show <task-id> [target-dir] [--json]
  memraft promote <memory-id> [target-dir] [--json]
  memraft accept <fingerprint> [target-dir] --into <background|conventions|workflows> [--json]
  memraft inspect latest [target-dir] [--json]
  memraft inspect pending [target-dir] [--json]
  memraft inspect proposals [target-dir] [--json]
  memraft inspect rules [target-dir] [--json]
  memraft inspect compiled [target-dir] [--json]
  memraft inspect lineage <fingerprint> [target-dir] [--json]
  node ./bin/memraft.js init [target-dir] [--force] [--skip-existing]

Commands:
  init              Initialize Memraft hooks and local memory scaffold
  status            Show Memraft runtime status for a repository
  recall            Search Memraft evidence and memories
  task              Manage Memraft task context
  promote           Promote a pending memory into repo-stable memory
  accept            Accept a promoted memory into checked-in shared spec
  inspect latest    Show the latest extracted evidence snapshot
  inspect pending   Show pending promotion candidates
  inspect proposals Show promoted local rules that are ready for shared review
  inspect rules     Show the current structured rule store
  inspect compiled  Show compiled outputs and adapter artifacts
  inspect lineage   Show rule lineage for a fingerprint

Options:
  --force           Overwrite existing Memraft template files
  --skip-existing   Preserve existing Memraft template files
  --scope           Limit recall to a specific memory scope
  --task            Limit recall to a task id
  --limit           Limit recall results
  --slug            Provide an explicit task slug
  --into            Choose a shared spec section for accept
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

function parseRecallArgs(args) {
  const positionals = [];
  let json = false;
  let scope = "";
  let task = "";
  let limit = 10;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--scope") {
      scope = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--task") {
      task = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const nextValue = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isFinite(nextValue) && nextValue > 0) {
        limit = nextValue;
      }
      index += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
    positionals.push(arg);
  }

  return {
    help: false,
    json,
    scope,
    task,
    limit,
    query: positionals[0] ?? "",
    targetDir: positionals[1] ?? process.cwd(),
  };
}

function parseTaskArgs(args, { requiresIdentifier = false } = {}) {
  const positionals = [];
  let json = false;
  let slug = "";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--slug") {
      slug = args[index + 1] ?? "";
      index += 1;
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
      slug,
      title: positionals[0] ?? "",
      targetDir: positionals[1] ?? process.cwd(),
    };
  }

  return {
    help: false,
    json,
    slug,
    identifier: positionals[0] ?? "",
    targetDir: positionals[1] ?? process.cwd(),
  };
}

function parseAcceptArgs(args) {
  const positionals = [];
  let json = false;
  let into = "";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--into") {
      into = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
    positionals.push(arg);
  }

  return {
    help: false,
    json,
    into,
    identifier: positionals[0] ?? "",
    targetDir: positionals[1] ?? process.cwd(),
  };
}

function getNodeCommand() {
  return "node";
}

function runMemraftPython(targetDir, args) {
  const paths = requireInitialized(targetDir);
  const result = spawnSync(getNodeCommand(), [paths.memraftCliPath, ...args], {
    cwd: paths.repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const message =
      result.stderr?.trim() || result.stdout?.trim() || "unknown Memraft runtime error";
    throw new Error(message);
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
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

    await initMemraft(options);
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

  if (command === "recall") {
    const options = parseRecallArgs(rest);
    if (options.help) {
      printHelp();
      return;
    }
    if (!options.query.trim()) {
      printHelp();
      throw new Error("recall requires a query");
    }
    const args = ["recall", options.query];
    if (options.scope) {
      args.push("--scope", options.scope);
    }
    if (options.task) {
      args.push("--task", options.task);
    }
    if (options.limit) {
      args.push("--limit", String(options.limit));
    }
    if (options.json) {
      args.push("--json");
    }
    runMemraftPython(options.targetDir, args);
    return;
  }

  if (command === "task") {
    const [subject, ...taskRest] = rest;
    if (subject === "create") {
      const options = parseTaskArgs(taskRest);
      if (options.help) {
        printHelp();
        return;
      }
      if (!options.title.trim()) {
        printHelp();
        throw new Error("task create requires a title");
      }
      const args = ["task", "create", options.title];
      if (options.slug) {
        args.push("--slug", options.slug);
      }
      if (options.json) {
        args.push("--json");
      }
      runMemraftPython(options.targetDir, args);
      return;
    }

    if (subject === "start" || subject === "finish" || subject === "show") {
      const options = parseTaskArgs(taskRest, { requiresIdentifier: true });
      if (options.help) {
        printHelp();
        return;
      }
      if (!options.identifier.trim()) {
        printHelp();
        throw new Error(`task ${subject} requires a task id`);
      }
      const args = ["task", subject, options.identifier];
      if (options.json) {
        args.push("--json");
      }
      runMemraftPython(options.targetDir, args);
      return;
    }

    printHelp();
    throw new Error(`Unknown task command: ${subject ?? "(missing)"}`);
  }

  if (command === "promote") {
    const options = parseTaskArgs(rest, { requiresIdentifier: true });
    if (options.help) {
      printHelp();
      return;
    }
    if (!options.identifier.trim()) {
      printHelp();
      throw new Error("promote requires a memory id");
    }
    const args = ["promote", options.identifier];
    if (options.json) {
      args.push("--json");
    }
    runMemraftPython(options.targetDir, args);
    return;
  }

  if (command === "accept") {
    const options = parseAcceptArgs(rest);
    if (options.help) {
      printHelp();
      return;
    }
    if (!options.identifier.trim()) {
      printHelp();
      throw new Error("accept requires a fingerprint");
    }
    if (!options.into.trim()) {
      printHelp();
      throw new Error("accept requires --into <background|conventions|workflows>");
    }
    const args = ["accept", options.identifier, "--into", options.into];
    if (options.json) {
      args.push("--json");
    }
    runMemraftPython(options.targetDir, args);
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
      const args = ["inspect", "latest"];
      if (options.json) {
        args.push("--json");
      }
      runMemraftPython(options.targetDir, args);
      return;
    }

    if (subject === "rules") {
      const options = parseInspectArgs(inspectRest);
      if (options.help) {
        printHelp();
        return;
      }
      const args = ["inspect", "rules"];
      if (options.json) {
        args.push("--json");
      }
      runMemraftPython(options.targetDir, args);
      return;
    }

    if (subject === "pending") {
      const options = parseInspectArgs(inspectRest);
      if (options.help) {
        printHelp();
        return;
      }
      const args = ["inspect", "pending"];
      if (options.json) {
        args.push("--json");
      }
      runMemraftPython(options.targetDir, args);
      return;
    }

    if (subject === "proposals") {
      const options = parseInspectArgs(inspectRest);
      if (options.help) {
        printHelp();
        return;
      }
      const args = ["inspect", "proposals"];
      if (options.json) {
        args.push("--json");
      }
      runMemraftPython(options.targetDir, args);
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
      if (!options.fingerprint.trim()) {
        printHelp();
        throw new Error("inspect lineage requires a fingerprint");
      }
      const args = ["inspect", "lineage", options.fingerprint];
      if (options.json) {
        args.push("--json");
      }
      runMemraftPython(options.targetDir, args);
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
