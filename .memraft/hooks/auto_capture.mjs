#!/usr/bin/env node
import { mainAutoCapture } from "./runtime.mjs";

const code = await mainAutoCapture(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
