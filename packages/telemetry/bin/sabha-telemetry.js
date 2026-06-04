#!/usr/bin/env node
import { runCli } from "../dist/cli.js";

runCli(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    // CLI itself crashing must still exit 0 — hooks should never block a
    // user action because telemetry malfunctioned.
    process.stderr.write(`sabha-telemetry: ${err?.message ?? err}\n`);
    process.exit(0);
  });
