#!/usr/bin/env node
import { mainCodexNotify } from "./runtime.mjs";

const code = await mainCodexNotify(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
