import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { TransportTargetOptions } from "pino";
import type { TelemetryConfig, TelemetryTransportSpec } from "./config.js";
import { sessionsDir } from "./paths.js";

/**
 * Builds pino's `transport.targets[]` array from a `TelemetryConfig`. The
 * defaults below land everything in a per-session JSONL file under the
 * telemetry root; user-provided `transports[]` entries pass straight through.
 *
 * Returns an empty array when telemetry is disabled — pino with no transports
 * is configured by the caller (`initTelemetry`) to drop events on the floor.
 */
export interface BuildTransportOpts {
  /** Active sessionId — used so each session gets its own JSONL file. */
  sessionId: string;
  /** Process env for path resolution (XDG_DATA_HOME, HOME). */
  env?: NodeJS.ProcessEnv;
  /**
   * pino's destination accepts a leading path which must already exist; we
   * mkdir it eagerly here so the first append doesn't crash on a fresh laptop.
   * Override only for tests that want to skip the mkdir.
   */
  ensureDirs?: boolean;
}

export function buildTransportTargets(
  config: TelemetryConfig,
  opts: BuildTransportOpts,
): TransportTargetOptions[] {
  if (!config.enabled) return [];

  const env = opts.env ?? process.env;
  const ensureDirs = opts.ensureDirs ?? true;
  const userTargets = config.transports ?? [];

  const targets: TransportTargetOptions[] =
    userTargets.length > 0
      ? userTargets.map((t) => materializeUserTarget(t, opts.sessionId, env))
      : [defaultJsonlTarget(opts.sessionId, env)];

  if (ensureDirs) {
    for (const t of targets) {
      const o = (t.options ?? {}) as Record<string, unknown>;
      const path =
        pickStringField(o, "destination") ?? pickStringField(o, "file");
      if (typeof path === "string") {
        try {
          mkdirSync(dirname(path), { recursive: true });
        } catch {
          // Best-effort; pino will surface a runtime error if the dir is
          // genuinely unwritable. Telemetry must never fail the call site.
        }
      }
    }
  }

  return targets;
}

function pickStringField(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function defaultJsonlTarget(
  sessionId: string,
  env: NodeJS.ProcessEnv,
): TransportTargetOptions {
  return {
    target: "pino/file",
    options: {
      destination: resolve(sessionsDir(env), `${sessionId}.jsonl`),
      mkdir: true,
      append: true,
    },
  };
}

function materializeUserTarget(
  spec: TelemetryTransportSpec,
  sessionId: string,
  env: NodeJS.ProcessEnv,
): TransportTargetOptions {
  const opts: Record<string, unknown> = { ...(spec.options ?? {}) };
  for (const key of ["file", "destination"]) {
    const val = opts[key];
    if (typeof val === "string") {
      opts[key] = expandPath(val.replace(/\$\{sessionId\}/g, sessionId), env);
    }
  }
  const out: TransportTargetOptions = {
    target: spec.target,
    options: opts,
  };
  if (spec.level !== undefined) out.level = spec.level;
  return out;
}

function expandPath(p: string, env: NodeJS.ProcessEnv): string {
  if (p === "~") return env.HOME ?? homedir();
  if (p.startsWith("~/")) return resolve(env.HOME ?? homedir(), p.slice(2));
  return p;
}
