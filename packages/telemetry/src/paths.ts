import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Telemetry data root. ONE stream for every Sabha general (the Stage-1
 * consolidation): events from argus, narada, and sabha-core all land here,
 * segmentable by the first-class `agent` property.
 *
 * Layout:
 *   ~/.local/share/sabha/telemetry/
 *     ├── current-session            (one-line file: active sessionId)
 *     ├── sessions/<sessionId>.jsonl (one event per line)
 *     └── meta/<sessionId>.json      (session start/end metadata)
 *
 * Honours XDG_DATA_HOME so tests can redirect by setting the env var.
 */
export function telemetryRoot(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_DATA_HOME ?? resolve(homedir(), ".local/share");
  return resolve(base, "sabha", "telemetry");
}

export function sessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(telemetryRoot(env), "sessions");
}

export function metaDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(telemetryRoot(env), "meta");
}

export function currentSessionFile(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(telemetryRoot(env), "current-session");
}

export function sessionLogFile(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(sessionsDir(env), `${sessionId}.jsonl`);
}

export function sessionMetaFile(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(metaDir(env), `${sessionId}.json`);
}
