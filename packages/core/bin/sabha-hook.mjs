#!/usr/bin/env node
/**
 * Hook dispatcher for sabha-core.
 *
 * Cursor/Claude hooks call this with a target + the real CLI args:
 *   node sabha-hook.mjs telemetry session-start
 *   node sabha-hook.mjs telemetry record tool.call
 *   node sabha-hook.mjs core update-check
 *
 * It first self-heals the plugin cache's node_modules (see ensure-deps.mjs),
 * then imports and runs the right CLI in-process. Hooks must NEVER block or
 * fail a user action, so every failure path is swallowed and we always exit 0.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDeps } from "./ensure-deps.mjs";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const ready = ensureDeps(pluginRoot);
  if (ready) {
    const [target, ...rest] = process.argv.slice(2);
    if (target === "telemetry") {
      const { runCli } = await import(
        join(
          pluginRoot,
          "node_modules",
          "@sabhahq",
          "telemetry",
          "dist",
          "cli.js",
        )
      );
      await runCli(rest);
    } else if (target === "core") {
      const { runCli } = await import(join(pluginRoot, "dist", "cli.js"));
      await runCli(rest);
    }
  }
} catch (err) {
  process.stderr.write(`sabha-hook: ${err?.message ?? err}\n`);
}

process.exit(0);
