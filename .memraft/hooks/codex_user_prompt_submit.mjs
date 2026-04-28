#!/usr/bin/env node
import { mainCodexUserPromptSubmit } from "./runtime.mjs";

const code = await mainCodexUserPromptSubmit(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
