#!/usr/bin/env node
import { mainManualCapture } from "./runtime.mjs";

const code = await mainManualCapture(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
