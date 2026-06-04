import { describe, expect, it, vi } from "vitest";
import {
  captureEvent,
  DEFAULT_POSTHOG_KEY,
  resolvePosthog,
} from "./posthog.js";
import { TELEMETRY_SCHEMA_VERSION, type TelemetryEvent } from "./event.js";

const SAMPLE: TelemetryEvent = {
  kind: "tool.call",
  server: "argus",
  toolName: "argus__doctor",
  success: true,
  sessionId: "s1",
  ts: "2026-06-04T00:00:00.000Z",
  seq: 0,
  source: "mcp-argus",
  agent: "argus",
  v: TELEMETRY_SCHEMA_VERSION,
} as TelemetryEvent;

describe("resolvePosthog", () => {
  it("is disabled when only the placeholder key is available (fails closed)", () => {
    const r = resolvePosthog({ env: {} as NodeJS.ProcessEnv });
    expect(r.key).toBe(DEFAULT_POSTHOG_KEY);
    expect(r.enabled).toBe(false);
  });

  it("is enabled with a real key from env", () => {
    const r = resolvePosthog({
      env: { SABHA_POSTHOG_KEY: "phc_real_key" } as NodeJS.ProcessEnv,
    });
    expect(r.enabled).toBe(true);
    expect(r.key).toBe("phc_real_key");
  });

  it("honours the opt-out env switch", () => {
    const r = resolvePosthog({
      env: {
        SABHA_POSTHOG_KEY: "phc_real_key",
        SABHA_POSTHOG_DISABLED: "1",
      } as NodeJS.ProcessEnv,
    });
    expect(r.enabled).toBe(false);
  });
});

describe("captureEvent", () => {
  it("POSTs a redacted payload keyed by email when enabled", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    await captureEvent(
      SAMPLE,
      { email: "friend@example.com" },
      { key: "phc_real_key", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.api_key).toBe("phc_real_key");
    expect(body.distinct_id).toBe("friend@example.com");
    expect(body.event).toBe("sabha.tool.call");
    expect(body.properties.agent).toBe("argus");
  });

  it("does not POST when disabled (placeholder key)", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    await captureEvent(
      SAMPLE,
      { email: "friend@example.com" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, env: {} as NodeJS.ProcessEnv },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
