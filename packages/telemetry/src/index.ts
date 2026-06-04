import pino, { type Logger } from "pino";
import {
  defaultsTelemetryConfig,
  type TelemetryConfig,
} from "./config.js";
import {
  TELEMETRY_SCHEMA_VERSION,
  type Agent,
  type EventSource,
  type TelemetryEvent,
  type TelemetryEventInput,
} from "./event.js";
import { readEmailSync } from "./identity.js";
import { captureEvent } from "./posthog.js";
import { readCurrentSessionSync } from "./session.js";
import { buildTransportTargets } from "./transport.js";

export type { TelemetryConfig, TelemetryTransportSpec } from "./config.js";
export { defaultsTelemetryConfig, parseTelemetryConfig } from "./config.js";
export type {
  Agent,
  EventSource,
  GateDecisionEvent,
  OutcomeSignalEvent,
  PromptSubmitEvent,
  RuleSnapshotEvent,
  SessionEndEvent,
  SessionStartEvent,
  SkillInvokeEvent,
  SubagentStartEvent,
  SubagentStopEvent,
  TelemetryEvent,
  TelemetryEventInput,
  ToolCallEvent,
} from "./event.js";
export {
  TELEMETRY_SCHEMA_VERSION,
  agentForServer,
  agentSchema,
  byteSize,
  hashArgs,
  newSessionId,
} from "./event.js";
export {
  clearCurrentSession,
  ensureTelemetryDirs,
  readCurrentSession,
  readCurrentSessionSync,
  readSessionMeta,
  setCurrentSession,
  writeSessionMeta,
  type SessionMeta,
} from "./session.js";
export {
  configDir,
  identityFile,
  readEmailSync,
  readIdentitySync,
  writeIdentity,
  type SabhaIdentity,
} from "./identity.js";
export {
  loadSabhaEnv,
  parseDotenv,
  type LoadEnvOptions,
  type LoadEnvResult,
} from "./env.js";
export {
  currentSessionFile,
  metaDir,
  sessionLogFile,
  sessionMetaFile,
  sessionsDir,
  telemetryRoot,
} from "./paths.js";
export { withTelemetry, type WithTelemetryContext } from "./middleware.js";
export { pruneOldSessions, type RetentionResult } from "./retention.js";
export { appendEventSync, type SyncWriteCtx } from "./syncWriter.js";
export { redactForPosthog, type RedactedEvent } from "./redact.js";
export {
  captureEvent,
  resolvePosthog,
  DEFAULT_POSTHOG_HOST,
  DEFAULT_POSTHOG_KEY,
  type PosthogIdentity,
  type PosthogOptions,
} from "./posthog.js";

export interface InitTelemetryOptions {
  /** What identifies the producer in the JSONL (e.g. "mcp-argus"). */
  source: EventSource;
  /** The first-class agent stamped on every event this runtime emits. */
  agent: Agent;
  /** Active sessionId; defaults to reading the current-session file. */
  sessionId?: string;
  /** Pre-parsed config; defaults to `defaultsTelemetryConfig()`. */
  config?: TelemetryConfig;
  /** Process env override (for tests). */
  env?: NodeJS.ProcessEnv;
  /**
   * Optional override of the pino instance — for tests that want to capture
   * the emitted events without touching disk. Bypasses transport building.
   */
  loggerOverride?: Logger;
}

interface TelemetryRuntime {
  logger: Logger | undefined;
  source: EventSource;
  agent: Agent;
  sessionId: string;
  config: TelemetryConfig;
  env: NodeJS.ProcessEnv;
  seq: number;
  enabled: boolean;
  initError: string | undefined;
}

let runtime: TelemetryRuntime | undefined;

/**
 * Boot the telemetry singleton. Idempotent — repeated calls reconfigure the
 * runtime (used by tests). Safe to call before the host has written a
 * `current-session` file; we fall back to an ephemeral id.
 */
export function initTelemetry(opts: InitTelemetryOptions): void {
  const env = opts.env ?? process.env;
  const config = opts.config ?? defaultsTelemetryConfig();
  const sessionId =
    opts.sessionId ?? readCurrentSessionSync(env) ?? "no-session";

  const baseRuntime: Omit<TelemetryRuntime, "logger" | "enabled"> = {
    source: opts.source,
    agent: opts.agent,
    sessionId,
    config,
    env,
    seq: 0,
    initError: undefined,
  };

  if (!config.enabled) {
    runtime = { ...baseRuntime, logger: undefined, enabled: false };
    return;
  }

  if (opts.loggerOverride) {
    runtime = { ...baseRuntime, logger: opts.loggerOverride, enabled: true };
    return;
  }

  try {
    const targets = buildTransportTargets(config, { sessionId, env });
    const logger =
      targets.length === 0
        ? pino({ enabled: false })
        : pino({
            timestamp: false,
            base: null,
            transport: { targets },
          });
    runtime = { ...baseRuntime, logger, enabled: true };
  } catch (err) {
    // Telemetry must never break the host. Record the error and silence the
    // emitter; the doctor probe surfaces this later.
    runtime = {
      ...baseRuntime,
      logger: undefined,
      enabled: false,
      initError: (err as Error).message,
    };
  }
}

/**
 * The single producer entry point. Stamps envelope fields (including the
 * first-class `agent`) and forwards to pino + the PostHog mirror. Fire-and-
 * forget: any thrown error is swallowed so a misconfigured transport can't
 * crash a tool handler. `agentOverride` lets a shared process emit on behalf
 * of a specific general; defaults to the runtime's configured agent.
 */
export function emitEvent(
  event: TelemetryEventInput,
  agentOverride?: Agent,
): void {
  const rt = runtime;
  if (!rt) return; // initTelemetry never ran — drop silently.
  if (!rt.enabled || !rt.logger) return;
  try {
    const enveloped: TelemetryEvent = {
      ...event,
      sessionId: rt.sessionId,
      ts: new Date().toISOString(),
      seq: rt.seq++,
      source: rt.source,
      agent: agentOverride ?? rt.agent,
      v: TELEMETRY_SCHEMA_VERSION,
    } as TelemetryEvent;
    rt.logger.info(enveloped);
    mirrorToPosthog(enveloped, rt);
  } catch {
    // Swallow — telemetry never throws into the call site.
  }
}

function mirrorToPosthog(event: TelemetryEvent, rt: TelemetryRuntime): void {
  if (!rt.config.posthog.enabled) return;
  try {
    const email = readEmailSync(rt.env);
    // Long-lived MCP process: fire-and-forget, never await.
    void captureEvent(event, { email }, { env: rt.env });
  } catch {
    // never throw
  }
}

/** Test-only: clears the singleton so the next initTelemetry starts fresh. */
export function resetTelemetryForTests(): void {
  runtime = undefined;
}

/** Inspection helper for the doctor probe and tests. */
export function telemetryStatus(): {
  enabled: boolean;
  source: EventSource;
  agent: Agent;
  sessionId: string;
  initError?: string;
} {
  if (!runtime) {
    return {
      enabled: false,
      source: "unknown",
      agent: "unknown",
      sessionId: "no-session",
    };
  }
  return {
    enabled: runtime.enabled,
    source: runtime.source,
    agent: runtime.agent,
    sessionId: runtime.sessionId,
    ...(runtime.initError !== undefined
      ? { initError: runtime.initError }
      : {}),
  };
}
