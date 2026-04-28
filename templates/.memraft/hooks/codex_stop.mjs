#!/usr/bin/env node
import { mainCodexStop } from "./runtime.mjs";

const code = await mainCodexStop(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
