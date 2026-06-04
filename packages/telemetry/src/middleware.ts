import { emitEvent } from "./index.js";
import { byteSize, hashArgs, type Agent } from "./event.js";

export interface WithTelemetryContext {
  /** Which Sabha general owns this tool (stamped as the first-class `agent`). */
  agent: Agent;
  /** Which server is emitting (e.g. "argus", "narada"). */
  server: string;
  /** The tool name registered with the MCP SDK (e.g. "argus__doctor"). */
  toolName: string;
}

/**
 * Wraps an MCP tool handler so every invocation emits a `tool.call` event —
 * regardless of whether the handler returned normally or threw. The single
 * shared middleware used by every Sabha general (Stage-1 consolidation).
 *
 * Errors are NEVER swallowed — we re-throw after emitting so the MCP SDK can
 * surface them to the agent. We only swallow telemetry's own failures.
 */
export function withTelemetry<Args, Result>(
  ctx: WithTelemetryContext,
  handler: (args: Args) => Promise<Result>,
): (args: Args) => Promise<Result> {
  return async (args: Args): Promise<Result> => {
    const startedAt = Date.now();
    let success = true;
    let errorCode: string | undefined;
    let result: Result | undefined;
    try {
      result = await handler(args);
      return result;
    } catch (err) {
      success = false;
      errorCode = classifyError(err);
      throw err;
    } finally {
      try {
        const durationMs = Date.now() - startedAt;
        const argsHash = hashArgs(args);
        const argsByteSize = byteSize(args);
        const resultByteSize =
          success && result !== undefined ? byteSize(result) : undefined;
        emitEvent(
          {
            kind: "tool.call",
            server: ctx.server,
            toolName: ctx.toolName,
            durationMs,
            success,
            ...(errorCode !== undefined ? { errorCode } : {}),
            ...(argsHash !== undefined ? { argsHash } : {}),
            ...(argsByteSize !== undefined ? { argsByteSize } : {}),
            ...(resultByteSize !== undefined ? { resultByteSize } : {}),
          },
          ctx.agent,
        );
      } catch {
        // Telemetry must never throw out of the wrapper.
      }
    }
  };
}

/**
 * Best-effort error classification: Sabha-general errors carry a typed `code`;
 * we surface it verbatim. For everything else, the constructor name is enough
 * for the reader skill to bucket failure modes without exposing message
 * contents.
 */
function classifyError(err: unknown): string {
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj["code"] === "string") return obj["code"] as string;
    if (typeof obj["name"] === "string") return obj["name"] as string;
  }
  return "UnknownError";
}
