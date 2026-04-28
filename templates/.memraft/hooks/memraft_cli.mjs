#!/usr/bin/env node
import { mainMemraftCli } from "./runtime.mjs";

const code = await mainMemraftCli(process.argv.slice(2));
if (Number.isInteger(code)) {
  process.exit(code);
}
