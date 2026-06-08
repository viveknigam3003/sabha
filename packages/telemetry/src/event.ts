import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";

/** Stable schema version stamped on every event. Bump on breaking changes. */
export const TELEMETRY_SCHEMA_VERSION = 2;

/**
 * Discriminator for which producer emitted a given row. The host hook layer
 * uses `hook`; each MCP server uses its own `mcp-<server>` tag. Combined with
 * `sessionId`, this lets the reader skill dedupe hook-side and server-side
 * `tool.call` rows that describe the same invocation.
 */
export const eventSourceSchema = z.enum([
  "hook",
  "mcp-argus",
  "mcp-narada",
  "mcp-sabha",
  "mcp-server",
  "unknown",
]);
export type EventSource = z.infer<typeof eventSourceSchema>;

/**
 * First-class `agent` property carried by EVERY event (the headline Stage-1
 * consolidation). One JSONL stream now holds rows from every Sabha general, so
 * the reader/PostHog must be able to segment by agent without reverse-engineering
 * `source` or `server`. Stamped by the producer (the MCP server knows its own
 * agent; the hook CLI infers it per-event from the tool/server).
 */
export const agentSchema = z.enum(["argus", "narada", "sabha", "unknown"]);
export type Agent = z.infer<typeof agentSchema>;

const baseEnvelope = z.object({
  sessionId: z.string(),
  ts: z.string(),
  seq: z.number().int().nonnegative(),
  source: eventSourceSchema,
  agent: agentSchema,
  v: z.number().int().positive(),
});

export const sessionStartEventSchema = baseEnvelope.extend({
  kind: z.literal("session.start"),
  host: z.string(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  agentMode: z.string().optional(),
  model: z.string().optional(),
});

export const sessionEndEventSchema = baseEnvelope.extend({
  kind: z.literal("session.end"),
  durationMs: z.number().nonnegative(),
  eventCounts: z.record(z.number().nonnegative()).optional(),
});

export const skillInvokeEventSchema = baseEnvelope.extend({
  kind: z.literal("skill.invoke"),
  skillName: z.string(),
  skillPath: z.string().optional(),
  origin: z.enum(["plugin", "user", "builtin", "unknown"]).default("unknown"),
});

export const subagentStartEventSchema = baseEnvelope.extend({
  kind: z.literal("subagent.start"),
  subagentType: z.string(),
  description: z.string().optional(),
  model: z.string().optional(),
  runInBackground: z.boolean().optional(),
});

export const subagentStopEventSchema = baseEnvelope.extend({
  kind: z.literal("subagent.stop"),
  subagentType: z.string(),
  durationMs: z.number().nonnegative().optional(),
  exitReason: z
    .enum(["completed", "cancelled", "failed", "unknown"])
    .optional(),
});

export const toolCallEventSchema = baseEnvelope.extend({
  kind: z.literal("tool.call"),
  server: z.string(),
  toolName: z.string(),
  durationMs: z.number().nonnegative().optional(),
  success: z.boolean(),
  errorCode: z.string().optional(),
  argsHash: z.string().optional(),
  argsByteSize: z.number().nonnegative().optional(),
  resultByteSize: z.number().nonnegative().optional(),
});

export const ruleSnapshotEventSchema = baseEnvelope.extend({
  kind: z.literal("rule.snapshot"),
  rules: z.array(
    z.object({
      id: z.string(),
      alwaysApply: z.boolean().optional(),
      origin: z
        .enum(["plugin", "user", "project", "unknown"])
        .default("unknown"),
    }),
  ),
});

export const promptSubmitEventSchema = baseEnvelope.extend({
  kind: z.literal("prompt.submit"),
  tokensApprox: z.number().nonnegative().optional(),
  hasAttachments: z.boolean().optional(),
});

export const outcomeSignalEventSchema = baseEnvelope.extend({
  kind: z.literal("outcome.signal"),
  outcome: z.enum(["apply", "reject", "error-cluster", "abandoned", "value"]),
  evidence: z.record(z.unknown()).optional(),
});

/** Emitted when a privileged tool is refused by the allowlist gate. */
export const gateDecisionEventSchema = baseEnvelope.extend({
  kind: z.literal("gate.decision"),
  toolName: z.string(),
  decision: z.enum(["allow", "deny"]),
  reason: z.string().optional(),
});

export const telemetryEventSchema = z.discriminatedUnion("kind", [
  sessionStartEventSchema,
  sessionEndEventSchema,
  skillInvokeEventSchema,
  subagentStartEventSchema,
  subagentStopEventSchema,
  toolCallEventSchema,
  ruleSnapshotEventSchema,
  promptSubmitEventSchema,
  outcomeSignalEventSchema,
  gateDecisionEventSchema,
]);

export type SessionStartEvent = z.infer<typeof sessionStartEventSchema>;
export type SessionEndEvent = z.infer<typeof sessionEndEventSchema>;
export type SkillInvokeEvent = z.infer<typeof skillInvokeEventSchema>;
export type SubagentStartEvent = z.infer<typeof subagentStartEventSchema>;
export type SubagentStopEvent = z.infer<typeof subagentStopEventSchema>;
export type ToolCallEvent = z.infer<typeof toolCallEventSchema>;
export type RuleSnapshotEvent = z.infer<typeof ruleSnapshotEventSchema>;
export type PromptSubmitEvent = z.infer<typeof promptSubmitEventSchema>;
export type OutcomeSignalEvent = z.infer<typeof outcomeSignalEventSchema>;
export type GateDecisionEvent = z.infer<typeof gateDecisionEventSchema>;
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

type StripEnvelope<E extends { kind: string }> = Omit<
  E,
  "sessionId" | "ts" | "seq" | "source" | "agent" | "v"
>;

/**
 * The minimal payload producers actually have to fill in. `sessionId`, `ts`,
 * `seq`, `source`, `agent`, and `v` are stamped by `emitEvent`; ULID generation
 * happens inside the facade. Producers stay focused on the domain payload.
 */
export type TelemetryEventInput =
  | StripEnvelope<SessionStartEvent>
  | StripEnvelope<SessionEndEvent>
  | StripEnvelope<SkillInvokeEvent>
  | StripEnvelope<SubagentStartEvent>
  | StripEnvelope<SubagentStopEvent>
  | StripEnvelope<ToolCallEvent>
  | StripEnvelope<RuleSnapshotEvent>
  | StripEnvelope<PromptSubmitEvent>
  | StripEnvelope<OutcomeSignalEvent>
  | StripEnvelope<GateDecisionEvent>;

export function newSessionId(): string {
  return ulid().toLowerCase();
}

/**
 * Stable, redacted args hash. We never persist raw argument values — only the
 * SHA-256 of the JSON-stringified args so the reader skill can correlate
 * repeat calls without exposing message bodies, NRQL fragments, Slack text,
 * etc. Returns `undefined` for `undefined`/`null` so the field stays absent.
 */
export function hashArgs(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  try {
    const json = JSON.stringify(args);
    if (!json) return undefined;
    return createHash("sha256").update(json).digest("hex").slice(0, 16);
  } catch {
    return undefined;
  }
}

export function byteSize(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Maps an MCP `server` name (or hook-inferred server) to the owning Sabha
 * agent. Used by the hook CLI to stamp `agent` on rows where it can only see
 * the tool/server, and by `withTelemetry` consumers that pass a bare server.
 */
export function agentForServer(server: string): Agent {
  switch (server) {
    case "argus":
      return "argus";
    case "narada":
      return "narada";
    case "sabha":
      return "sabha";
    default:
      return "unknown";
  }
}
