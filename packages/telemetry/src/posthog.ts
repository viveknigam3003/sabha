import type { TelemetryEvent } from "./event.js";
import { redactForPosthog } from "./redact.js";

/**
 * Client-side PostHog mirror. Events are sent DIRECTLY from the user's machine
 * to PostHog Cloud (no Sabha backend in Stage 1). The project key is bundled
 * (public, write-only capture key — safe to ship) and overridable via env for
 * dev/test. `distinct_id` is the user's Sabha email so usage is segmentable
 * per-person and per-`agent`.
 *
 * Everything here is best-effort and fail-silent: a network blip, an offline
 * laptop, or a misconfigured key must never break a tool call or a hook.
 */

/** Bundled write-only capture key. Replace at release; override via env. */
export const DEFAULT_POSTHOG_KEY = "phc_SABHA_PROJECT_KEY_PLACEHOLDER";
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const ANONYMOUS_DISTINCT_ID = "sabha-anonymous";
const POST_TIMEOUT_MS = 2500;

export interface PosthogIdentity {
  /** The user's Sabha email (PostHog distinct_id). Falls back to anonymous. */
  email?: string | undefined;
}

export interface PosthogOptions {
  enabled?: boolean;
  key?: string;
  host?: string;
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface ResolvedPosthog {
  enabled: boolean;
  key: string;
  host: string;
  fetchImpl: typeof fetch;
}

/**
 * Resolves the effective PostHog configuration from explicit opts → env →
 * bundled defaults. Disabled when the master switch is off, when the user opts
 * out via `SABHA_POSTHOG_DISABLED`, or when no real key is available (the
 * placeholder never sends — so a forgotten release key fails closed rather
 * than spraying a dead project).
 */
export function resolvePosthog(opts: PosthogOptions = {}): ResolvedPosthog {
  const env = opts.env ?? process.env;
  const key = opts.key ?? env.SABHA_POSTHOG_KEY ?? DEFAULT_POSTHOG_KEY;
  const host = opts.host ?? env.SABHA_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST;
  const optedOut =
    env.SABHA_POSTHOG_DISABLED === "1" || env.SABHA_POSTHOG_DISABLED === "true";
  const hasRealKey =
    typeof key === "string" &&
    key.length > 0 &&
    key !== DEFAULT_POSTHOG_KEY;
  const enabled = (opts.enabled ?? true) && !optedOut && hasRealKey;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  return { enabled, key, host, fetchImpl };
}

function distinctId(identity: PosthogIdentity): string {
  const email = identity.email?.trim();
  return email && email.length > 0 ? email : ANONYMOUS_DISTINCT_ID;
}

/**
 * Mirrors a single telemetry event to PostHog after the redaction pass.
 * Returns a promise that resolves once the POST settles (or times out). The
 * caller decides whether to await: the hook CLI awaits (short-lived process),
 * the long-lived MCP fires-and-forgets.
 */
export async function captureEvent(
  event: TelemetryEvent,
  identity: PosthogIdentity,
  opts: PosthogOptions = {},
): Promise<void> {
  const resolved = resolvePosthog(opts);
  if (!resolved.enabled) return;
  const { event: name, properties } = redactForPosthog(event);

  const body: Record<string, unknown> = {
    api_key: resolved.key,
    event: name,
    distinct_id: distinctId(identity),
    timestamp: event.ts,
    properties: {
      ...properties,
      $lib: "sabha-telemetry",
    },
  };

  // On session.start, also set person properties so PostHog can pivot people
  // by the agents they use. `$set` is PostHog's documented person-prop merge.
  if (event.kind === "session.start") {
    (body.properties as Record<string, unknown>)["$set"] = {
      email: distinctId(identity),
    };
  }

  await postWithTimeout(resolved, body);
}

async function postWithTimeout(
  resolved: ResolvedPosthog,
  body: unknown,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    await resolved.fetchImpl(`${resolved.host.replace(/\/+$/, "")}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // Fail-silent: offline, blocked, timed out — telemetry never blocks work.
  } finally {
    clearTimeout(timer);
  }
}
