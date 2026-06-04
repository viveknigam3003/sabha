import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Zero-dependency `.env` loader for Sabha config. Lets every general be
 * configured from a FILE instead of only exported shell vars — important for
 * installed plugins, whose MCP/hook subprocesses don't inherit your interactive
 * shell's exports.
 *
 * Precedence (highest first). A real, already-set `process.env` value ALWAYS
 * wins; `.env` files only fill the gaps, and earlier files win over later ones:
 *
 *   1. process.env                       (explicit shell export — never overridden)
 *   2. $SABHA_ENV_FILE                   (explicit override path)
 *   3. ~/.config/sabha/.env              (canonical per-user runtime config)
 *   4. $CLAUDE_PLUGIN_ROOT/.env          (shipped alongside the installed plugin)
 *   5. <cwd>/.env                        (repo-local dev convenience)
 *
 * Only keys prefixed `SABHA_` (plus the XDG/HOME path overrides we already
 * honour) are applied, so a stray project `.env` can't inject arbitrary
 * environment into the agent process.
 */

const ALLOWED_PREFIXES = ["SABHA_"];
const ALLOWED_EXACT = new Set(["XDG_CONFIG_HOME", "XDG_DATA_HOME", "HOME"]);

export interface LoadEnvOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Explicit file list (overrides the default search order). For tests. */
  files?: string[];
  /** Re-run even if already loaded this process. */
  force?: boolean;
}

export interface LoadEnvResult {
  /** Files that existed and were parsed. */
  loaded: string[];
  /** Keys actually applied to process.env (were previously unset). */
  applied: string[];
}

let didLoad = false;

/** Parse `.env` text: `KEY=VALUE`, `#` comments, optional `export`, quotes. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;
    let value = withoutExport.slice(eq + 1).trim();
    // Strip a single layer of matching quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function isAllowedKey(key: string): boolean {
  if (ALLOWED_EXACT.has(key)) return true;
  return ALLOWED_PREFIXES.some((p) => key.startsWith(p));
}

function candidateFiles(
  env: NodeJS.ProcessEnv,
  cwd: string,
): string[] {
  const files: string[] = [];
  if (env.SABHA_ENV_FILE) files.push(env.SABHA_ENV_FILE);
  const configHome = env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config");
  files.push(resolve(configHome, "sabha", ".env"));
  if (env.CLAUDE_PLUGIN_ROOT) {
    files.push(resolve(env.CLAUDE_PLUGIN_ROOT, ".env"));
  }
  files.push(resolve(cwd, ".env"));
  return files;
}

/**
 * Loads Sabha `.env` files into `process.env` (idempotent per process). Safe
 * and fail-silent: a missing/locked/garbled file is skipped. Returns which
 * files were read and which keys were newly applied.
 */
export function loadSabhaEnv(opts: LoadEnvOptions = {}): LoadEnvResult {
  const env = opts.env ?? process.env;
  if (didLoad && !opts.force && !opts.files) {
    return { loaded: [], applied: [] };
  }
  const cwd = opts.cwd ?? process.cwd();
  const files = opts.files ?? candidateFiles(env, cwd);

  const loaded: string[] = [];
  const applied: string[] = [];

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // missing / unreadable — skip
    }
    loaded.push(file);
    const parsed = parseDotenv(text);
    for (const [key, value] of Object.entries(parsed)) {
      if (!isAllowedKey(key)) continue;
      // process.env wins; earlier files win over later files.
      if (env[key] === undefined) {
        env[key] = value;
        applied.push(key);
      }
    }
  }

  if (!opts.files) didLoad = true;
  return { loaded, applied };
}

/** Test-only: reset the idempotency guard. */
export function resetEnvLoadedForTests(): void {
  didLoad = false;
}
