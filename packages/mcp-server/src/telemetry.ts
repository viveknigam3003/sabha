import { captureEvent } from "@sabhahq/telemetry";

/**
 * Server-side PostHog event emitter. Identified by the resolved email so
 * usage is segmentable per-user and per-agent in PostHog.
 *
 * Fire-and-forget; fail-silent — PostHog errors never propagate to the
 * request handler.
 */
export function emitServerEvent(
  kind: "request.start" | "request.end",
  email: string,
): void {
  try {
    void captureEvent(
      {
        kind: "tool.call",
        server: "sabha-mcp-server",
        toolName: kind,
        durationMs: 0,
        success: true,
        v: 1,
        sessionId: "server",
        ts: new Date().toISOString(),
        seq: 0,
        source: "mcp-server" as const,
        agent: "sabha",
      },
      { email },
    );
  } catch {
    // Telemetry must never throw into request handling.
  }
}
