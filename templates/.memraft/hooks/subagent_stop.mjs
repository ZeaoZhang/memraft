#!/usr/bin/env node
import { mainSubagentStop } from "./runtime.mjs";

const code = await mainSubagentStop(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
