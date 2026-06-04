import { describe, expect, it } from "vitest";
import { redactForPosthog } from "./redact.js";
import { TELEMETRY_SCHEMA_VERSION, type TelemetryEvent } from "./event.js";

function envelope<T extends Record<string, unknown>>(e: T): T & {
  sessionId: string;
  ts: string;
  seq: number;
  source: "hook";
  agent: "argus";
  v: number;
} {
  return {
    sessionId: "s1",
    ts: "2026-06-04T00:00:00.000Z",
    seq: 0,
    source: "hook",
    agent: "argus",
    v: TELEMETRY_SCHEMA_VERSION,
    ...e,
  };
}

describe("redactForPosthog", () => {
  it("drops cwd + gitBranch from session.start but keeps host/agent", () => {
    const event = envelope({
      kind: "session.start",
      host: "cursor",
      cwd: "/Users/secret/repos/private-thing",
      gitBranch: "feature/secret-branch",
    }) as unknown as TelemetryEvent;
    const { event: name, properties } = redactForPosthog(event);
    expect(name).toBe("sabha.session.start");
    expect(properties.agent).toBe("argus");
    expect(properties.host).toBe("cursor");
    expect(JSON.stringify(properties)).not.toContain("secret");
    expect(properties.cwd).toBeUndefined();
    expect(properties.gitBranch).toBeUndefined();
  });

  it("forwards tool.call sizes + names but never the args hash", () => {
    const event = envelope({
      kind: "tool.call",
      server: "argus",
      toolName: "argus__run_query",
      success: true,
      durationMs: 12,
      argsHash: "deadbeefdeadbeef",
      argsByteSize: 100,
      resultByteSize: 200,
    }) as unknown as TelemetryEvent;
    const { properties } = redactForPosthog(event);
    expect(properties.tool_name).toBe("argus__run_query");
    expect(properties.args_byte_size).toBe(100);
    expect(JSON.stringify(properties)).not.toContain("deadbeef");
  });

  it("reduces rule.snapshot to a count, never the rule ids/paths", () => {
    const event = envelope({
      kind: "rule.snapshot",
      rules: [
        { id: "/Users/secret/.cursor/rules/a.mdc", origin: "user" },
        { id: "/Users/secret/.cursor/rules/b.mdc", origin: "user" },
      ],
    }) as unknown as TelemetryEvent;
    const { properties } = redactForPosthog(event);
    expect(properties.rule_count).toBe(2);
    expect(JSON.stringify(properties)).not.toContain("secret");
  });

  it("drops subagent free-text description", () => {
    const event = envelope({
      kind: "subagent.start",
      subagentType: "explore",
      description: "go read the secret credentials file",
    }) as unknown as TelemetryEvent;
    const { properties } = redactForPosthog(event);
    expect(properties.subagent_type).toBe("explore");
    expect(JSON.stringify(properties)).not.toContain("secret");
  });
});
