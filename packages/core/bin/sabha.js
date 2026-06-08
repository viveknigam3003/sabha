#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDeps } from "./ensure-deps.mjs";

// Self-heal the plugin cache's node_modules before importing the CLI (whose
// dist imports @sabhahq/telemetry). No-op once deps exist or when run via npx /
// a global install. Surface a one-time note since a human is watching here.
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
ensureDeps(pluginRoot, { quiet: false });

const { runCli } = await import(join(pluginRoot, "dist", "cli.js"));

runCli(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`sabha: ${err?.message ?? err}\n`);
    // A crashing helper CLI should not hard-fail a hook context.
    process.exit(0);
  });
