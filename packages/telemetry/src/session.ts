import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { currentSessionFile, sessionMetaFile, telemetryRoot } from "./paths.js";

/**
 * Session metadata persisted at session.start by the host hook. Read by every
 * MCP server (cached for the lifetime of a tool call) so its tool.call events
 * can be stamped with the same sessionId the hooks use.
 */
export interface SessionMeta {
  sessionId: string;
  startedAt: string;
  host: string;
  cwd?: string;
  gitBranch?: string;
  source: string;
}

/**
 * Writes the active sessionId to disk so any MCP server can pick it up
 * without env-var plumbing. Atomic-enough: a single-line file, single
 * writer (the sessionStart hook), every reader tolerates absence.
 */
export async function setCurrentSession(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const file = currentSessionFile(env);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${sessionId}\n`, "utf8");
}

export async function clearCurrentSession(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const file = currentSessionFile(env);
  try {
    await rm(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * Best-effort lookup of the active session. Returns undefined when no session
 * file exists (fresh machine, between sessions, etc.). Never throws — callers
 * fall back to an ephemeral id rather than blocking on missing telemetry.
 */
export async function readCurrentSession(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const file = currentSessionFile(env);
  try {
    const raw = await readFile(file, "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Synchronous variant for the MCP middleware. The middleware runs once per
 * tool call and we don't want to thread async through every handler just to
 * fetch a string. Returns undefined on any failure.
 */
export function readCurrentSessionSync(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  try {
    const raw = readFileSync(currentSessionFile(env), "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export async function writeSessionMeta(
  meta: SessionMeta,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const file = sessionMetaFile(meta.sessionId, env);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(meta, null, 2), "utf8");
}

export async function readSessionMeta(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionMeta | undefined> {
  const file = sessionMetaFile(sessionId, env);
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as SessionMeta;
  } catch {
    return undefined;
  }
}

export async function ensureTelemetryDirs(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await mkdir(telemetryRoot(env), { recursive: true });
}
