#!/usr/bin/env node
import { mainPreToolUse } from "./runtime.mjs";

const code = await mainPreToolUse(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
