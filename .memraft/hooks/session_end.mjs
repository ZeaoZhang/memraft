#!/usr/bin/env node
import { mainSessionEnd } from "./runtime.mjs";

const code = await mainSessionEnd(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
