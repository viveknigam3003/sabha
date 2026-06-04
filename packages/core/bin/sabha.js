#!/usr/bin/env node
import { runCli } from "../dist/cli.js";

runCli(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`sabha: ${err?.message ?? err}\n`);
    // A crashing helper CLI should not hard-fail a hook context.
    process.exit(0);
  });
