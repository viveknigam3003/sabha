/**
 * Self-heal the plugin cache's node_modules.
 *
 * The Sabha marketplace installs `@sabhahq/core` by copying the npm package
 * into ~/.claude/plugins/cache/... but never runs `npm install`. That leaves
 * `node_modules/` absent, so the hooks (which import `@sabhahq/telemetry`) and
 * the `sabha` CLI (whose dist imports it too) fail with ERR_MODULE_NOT_FOUND.
 *
 * ensureDeps() runs a one-time `npm install --omit=dev` in the plugin root when
 * the telemetry dep is missing. It is a no-op when:
 *   - deps are already present (normal case after first run, or a real
 *     `npm install -g` / `npx` invocation), or
 *   - there is no package.json to install from (e.g. a local dev install that
 *     strips package.json from the cache and relies on workspace resolution).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function ensureDeps(pluginRoot, { quiet = true } = {}) {
  const marker = join(
    pluginRoot,
    "node_modules",
    "@sabhahq",
    "telemetry",
    "package.json",
  );
  if (existsSync(marker)) return true;

  // Nothing to install from — caller resolves deps some other way.
  if (!existsSync(join(pluginRoot, "package.json"))) return false;

  if (!quiet) {
    process.stderr.write(
      "sabha: installing runtime dependencies (one-time)…\n",
    );
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = spawnSync(
    npm,
    ["install", "--omit=dev", "--no-fund", "--no-audit"],
    { cwd: pluginRoot, stdio: quiet ? "ignore" : "inherit", env: process.env },
  );
  return res.status === 0;
}
