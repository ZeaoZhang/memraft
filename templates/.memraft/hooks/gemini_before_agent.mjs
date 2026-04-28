#!/usr/bin/env node
import { mainGeminiBeforeAgent } from "./runtime.mjs";

const code = await mainGeminiBeforeAgent(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
