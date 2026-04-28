#!/usr/bin/env node
import { mainSubagentStart } from "./runtime.mjs";

const code = await mainSubagentStart(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
