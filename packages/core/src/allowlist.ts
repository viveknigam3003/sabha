import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { allowlistCacheFile } from "./paths.js";

/**
 * Hashed (SHA-256) email allowlist. The maintainer publishes a static JSON
 * document of email hashes to a private source; the runtime fetches it,
 * caches it (TTL + offline grace), and fails CLOSED for any email it can't
 * positively confirm. Approve = add a hash; revoke = remove it.
 *
 * Why hashes, not emails: the source can be world-readable (a gist, a raw
 * GitHub URL) without leaking the list of registered users' addresses.
 *
 * This is a SOFT deterrent by design (Stage 1): the code runs locally and is
 * patchable. Hard enforcement arrives at Stage 2 (remote MCP). Don't over-
 * invest in local "protection" here.
 */

/**
 * Bundled allowlist source — the `allowlist.json` committed at the root of the
 * public `sabha` repo (hashes only, so it's safe to be public). Updating access
 * is just a commit there; no release needed. Override via env for
 * dev/test/self-hosting (a `file://` path or plain path reads from disk).
 */
export const DEFAULT_ALLOWLIST_URL =
  "https://raw.githubusercontent.com/viveknigam3003/sabha/main/allowlist.json";

const TTL_MS = 12 * 60 * 60 * 1000; // refetch after 12h
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // serve stale up to 7d offline
const FETCH_TIMEOUT_MS = 3000;

const remoteSchema = z.object({
  version: z.number().int().optional(),
  hashes: z.array(z.string()),
});

const cacheSchema = z.object({
  fetchedAt: z.string(),
  version: z.number().int().optional(),
  hashes: z.array(z.string()),
});
type CacheDoc = z.infer<typeof cacheSchema>;

export type AllowlistSource = "network" | "cache" | "grace" | "none";

export interface AllowlistSnapshot {
  hashes: Set<string>;
  source: AllowlistSource;
}

export interface AllowlistOptions {
  url?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Normalize + hash an email exactly as the published list does. */
export function emailHash(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

function resolveUrl(opts: AllowlistOptions): string {
  const env = opts.env ?? process.env;
  return opts.url ?? env.SABHA_ALLOWLIST_URL ?? DEFAULT_ALLOWLIST_URL;
}

function readCache(env: NodeJS.ProcessEnv): CacheDoc | undefined {
  try {
    const raw = readFileSync(allowlistCacheFile(env), "utf8");
    const parsed = cacheSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(env: NodeJS.ProcessEnv, doc: CacheDoc): void {
  try {
    const file = allowlistCacheFile(env);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
  } catch {
    // Best-effort cache; a read-only disk just means we refetch next time.
  }
}

/** `http(s)://` → network fetch; `file://` or a bare path → read from disk. */
function isLocalSource(url: string): boolean {
  return url.startsWith("file://") || !/^[a-z]+:\/\//i.test(url);
}

function localPathFor(url: string): string {
  if (url.startsWith("file://")) return fileURLToPath(url);
  return resolvePath(process.cwd(), url);
}

function toRemoteShape(json: unknown): { hashes: string[]; version?: number } {
  const parsed = remoteSchema.parse(json);
  return {
    hashes: parsed.hashes.map((h) => h.toLowerCase()),
    ...(parsed.version !== undefined ? { version: parsed.version } : {}),
  };
}

async function fetchRemote(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ hashes: string[]; version?: number }> {
  // Local source: lets SABHA_ALLOWLIST_URL point straight at the file the
  // `scripts/allowlist.mjs` editor maintains (file:// or a plain path), so
  // local/dev use needs no hosting. (Node's fetch can't read file://.)
  if (isLocalSource(url)) {
    return toRemoteShape(JSON.parse(readFileSync(localPathFor(url), "utf8")));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`allowlist fetch failed: HTTP ${res.status}`);
    return toRemoteShape(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Loads the allowlist with full caching semantics:
 *   - fresh cache (< TTL)            → serve from cache, no network
 *   - stale/absent cache             → fetch; on success refresh cache
 *   - fetch fails but cache in grace → serve stale (offline grace)
 *   - fetch fails and no usable cache→ `none` (fail-closed: deny everything)
 */
export async function loadAllowlist(
  opts: AllowlistOptions = {},
): Promise<AllowlistSnapshot> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const url = resolveUrl(opts);

  const cache = readCache(env);
  const cacheAge = cache ? now() - Date.parse(cache.fetchedAt) : Infinity;

  if (cache && Number.isFinite(cacheAge) && cacheAge < TTL_MS) {
    return { hashes: new Set(cache.hashes), source: "cache" };
  }

  try {
    const remote = await fetchRemote(url, fetchImpl);
    const doc: CacheDoc = {
      fetchedAt: new Date(now()).toISOString(),
      hashes: remote.hashes,
      ...(remote.version !== undefined ? { version: remote.version } : {}),
    };
    writeCache(env, doc);
    return { hashes: new Set(remote.hashes), source: "network" };
  } catch {
    if (cache && Number.isFinite(cacheAge) && cacheAge < TTL_MS + OFFLINE_GRACE_MS) {
      return { hashes: new Set(cache.hashes), source: "grace" };
    }
    return { hashes: new Set<string>(), source: "none" };
  }
}

export interface AllowlistDecision {
  allowed: boolean;
  source: AllowlistSource;
  reason: string;
}

/**
 * The single authoritative check. Fails closed: an unavailable list (`none`)
 * denies everyone, and an email whose hash isn't present is denied.
 */
export async function isAllowed(
  email: string,
  opts: AllowlistOptions = {},
): Promise<AllowlistDecision> {
  const snapshot = await loadAllowlist(opts);
  if (snapshot.source === "none") {
    return {
      allowed: false,
      source: "none",
      reason: "allowlist unavailable (offline and no cached list) — failing closed",
    };
  }
  const allowed = snapshot.hashes.has(emailHash(email));
  return {
    allowed,
    source: snapshot.source,
    reason: allowed ? "email on allowlist" : "email not on allowlist",
  };
}
