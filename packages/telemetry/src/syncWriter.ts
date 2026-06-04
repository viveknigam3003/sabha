import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  TELEMETRY_SCHEMA_VERSION,
  type Agent,
  type EventSource,
  type TelemetryEvent,
  type TelemetryEventInput,
} from "./event.js";
import { sessionLogFile } from "./paths.js";

export interface SyncWriteCtx {
  sessionId: string;
  source: EventSource;
  agent: Agent;
  seq?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Synchronous JSONL append. Used by the `sabha-telemetry` CLI, which is a
 * short-lived hook subprocess where pino's worker-thread transports would
 * drop events on exit. The MCP server (long-lived process) keeps using the
 * async pino path via `emitEvent`.
 *
 * Returns the fully-enveloped event (for the caller to optionally mirror to
 * PostHog) or undefined on failure. Never throws — telemetry must not break a
 * hook invocation.
 */
export function appendEventSync(
  event: TelemetryEventInput,
  ctx: SyncWriteCtx,
): TelemetryEvent | undefined {
  try {
    const file = sessionLogFile(ctx.sessionId, ctx.env);
    mkdirSync(dirname(file), { recursive: true });
    const enveloped = {
      ...event,
      sessionId: ctx.sessionId,
      ts: new Date().toISOString(),
      seq: ctx.seq ?? 0,
      source: ctx.source,
      agent: ctx.agent,
      v: TELEMETRY_SCHEMA_VERSION,
    } as TelemetryEvent;
    appendFileSync(file, JSON.stringify(enveloped) + "\n", "utf8");
    return enveloped;
  } catch {
    // Swallow — never break the hook.
    return undefined;
  }
}
