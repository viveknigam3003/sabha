import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { updateCheckFile } from "./paths.js";

/**
 * Auto-update hint. A `sessionStart` hook calls this once/day (cached); when a
 * newer Sabha marketplace version is published it returns a one-line nudge to
 * run `/plugin marketplace update`. Non-blocking and fail-silent: an offline
 * laptop, a slow network, or a malformed manifest all resolve to "no hint".
 */

/** This package's version — the floor we compare the published marketplace to. */
export const SABHA_VERSION = "0.2.0";

export const DEFAULT_MARKETPLACE_URL =
  "https://raw.githubusercontent.com/viveknigam3003/sabha/main/.claude-plugin/marketplace.json";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once/day
const FETCH_TIMEOUT_MS = 2500;

const stampSchema = z.object({
  checkedAt: z.string(),
  latest: z.string(),
});
type Stamp = z.infer<typeof stampSchema>;

export interface UpdateOptions {
  url?: string;
  currentVersion?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface UpdateResult {
  current: string;
  latest: string | undefined;
  updateAvailable: boolean;
  hint?: string;
  checked: "network" | "cache" | "skipped";
}

/** `1.2.0` > `1.1.9`. Tolerant of pre-release suffixes (compared lexically). */
export function semverGt(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function currentVersion(opts: UpdateOptions): string {
  const env = opts.env ?? process.env;
  return opts.currentVersion ?? env.SABHA_INSTALLED_VERSION ?? SABHA_VERSION;
}

function resolveUrl(opts: UpdateOptions): string {
  const env = opts.env ?? process.env;
  return opts.url ?? env.SABHA_MARKETPLACE_URL ?? DEFAULT_MARKETPLACE_URL;
}

function readStamp(env: NodeJS.ProcessEnv): Stamp | undefined {
  try {
    const raw = readFileSync(updateCheckFile(env), "utf8");
    const parsed = stampSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeStamp(env: NodeJS.ProcessEnv, stamp: Stamp): void {
  try {
    const file = updateCheckFile(env);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(stamp, null, 2) + "\n", "utf8");
  } catch {
    // best-effort
  }
}

async function fetchLatest(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { metadata?: { version?: unknown } };
    const v = json.metadata?.version;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function hintFor(latest: string): string {
  return `Sabha ${latest} is available. Run \`/plugin marketplace update\` and restart to upgrade.`;
}

export async function checkForUpdate(
  opts: UpdateOptions = {},
): Promise<UpdateResult> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const current = currentVersion(opts);

  const stamp = readStamp(env);
  const stampAge = stamp ? now() - Date.parse(stamp.checkedAt) : Infinity;

  // Within the daily window: reuse the last known latest, no network.
  if (stamp && Number.isFinite(stampAge) && stampAge < CHECK_INTERVAL_MS) {
    const updateAvailable = semverGt(stamp.latest, current);
    return {
      current,
      latest: stamp.latest,
      updateAvailable,
      checked: "cache",
      ...(updateAvailable ? { hint: hintFor(stamp.latest) } : {}),
    };
  }

  const latest = await fetchLatest(resolveUrl(opts), fetchImpl);
  if (latest === undefined) {
    return { current, latest: undefined, updateAvailable: false, checked: "skipped" };
  }
  writeStamp(env, { checkedAt: new Date(now()).toISOString(), latest });
  const updateAvailable = semverGt(latest, current);
  return {
    current,
    latest,
    updateAvailable,
    checked: "network",
    ...(updateAvailable ? { hint: hintFor(latest) } : {}),
  };
}
