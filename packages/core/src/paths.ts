import { homedir } from "node:os";
import { resolve } from "node:path";

/** Re-exported from telemetry so there's one canonical config dir. */
export { configDir, identityFile } from "@sabhahq/telemetry";

/**
 * Sabha data root (caches: allowlist snapshot, update-check stamp). Mirrors the
 * telemetry root's parent so everything Sabha writes lives under one tree.
 * Honours XDG_DATA_HOME for tests.
 */
export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_DATA_HOME ?? resolve(homedir(), ".local/share");
  return resolve(base, "sabha");
}

export function allowlistCacheFile(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(dataRoot(env), "allowlist-cache.json");
}

export function updateCheckFile(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(dataRoot(env), "update-check.json");
}
