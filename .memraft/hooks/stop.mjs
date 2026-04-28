#!/usr/bin/env node
import { mainStop } from "./runtime.mjs";

const code = await mainStop(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
