#!/usr/bin/env node
import { mainSessionStart } from "./runtime.mjs";

const code = await mainSessionStart(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
