import { basename } from "node:path";
import type { TelemetryEvent } from "./event.js";

/**
 * Client-side redaction pass (Stage-1 exit criterion: "no secrets/PII in
 * PostHog"). The JSONL stream on the user's own disk is already low-risk — it
 * carries arg *hashes*, never raw arguments. But before anything leaves the
 * machine for PostHog Cloud we apply a strict ALLOWLIST: only the explicitly
 * enumerated, known-safe fields per event kind are forwarded. Anything not in
 * the allowlist (NRQL text, Slack content, provider keys, full cwd paths, free
 * text descriptions) never makes the trip.
 *
 * The guiding rule: deny by default. New event fields are invisible to PostHog
 * until someone deliberately adds them here.
 */
export interface RedactedEvent {
  /** PostHog event name. */
  event: string;
  /** Flat, safe property bag. */
  properties: Record<string, string | number | boolean>;
}

/** Reduce any filesystem-ish string to its basename so paths never leak. */
function safeName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Skill/rule ids are often absolute paths; only the leaf is meaningful and
  // it can't contain a home dir, repo name, or directory layout.
  const leaf = basename(value);
  return leaf.length > 0 ? leaf : undefined;
}

function put(
  bag: Record<string, string | number | boolean>,
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (value !== undefined) bag[key] = value;
}

/**
 * Converts a fully-enveloped telemetry event into a redacted PostHog payload.
 * Returns `undefined` for events we deliberately don't mirror (none today, but
 * the seam exists). Envelope-level safe fields (`agent`, `source`, `sessionId`,
 * `seq`) are always included so PostHog can segment + dedupe.
 */
export function redactForPosthog(event: TelemetryEvent): RedactedEvent {
  const props: Record<string, string | number | boolean> = {
    agent: event.agent,
    source: event.source,
    session_id: event.sessionId,
    seq: event.seq,
    schema_version: event.v,
  };

  switch (event.kind) {
    case "session.start":
      put(props, "host", event.host);
      put(props, "agent_mode", event.agentMode);
      put(props, "model", event.model);
      // NOTE: cwd + gitBranch deliberately dropped (repo/dir names are PII-ish).
      break;
    case "session.end":
      put(props, "duration_ms", event.durationMs);
      break;
    case "skill.invoke":
      put(props, "skill_name", event.skillName);
      put(props, "origin", event.origin);
      // skillPath dropped — only the (already-present) skill_name is forwarded.
      break;
    case "subagent.start":
      put(props, "subagent_type", event.subagentType);
      put(props, "model", event.model);
      put(props, "run_in_background", event.runInBackground);
      // description dropped — free text.
      break;
    case "subagent.stop":
      put(props, "subagent_type", event.subagentType);
      put(props, "duration_ms", event.durationMs);
      put(props, "exit_reason", event.exitReason);
      break;
    case "tool.call":
      put(props, "server", event.server);
      put(props, "tool_name", event.toolName);
      put(props, "duration_ms", event.durationMs);
      put(props, "success", event.success);
      put(props, "error_code", event.errorCode);
      // argsHash is a one-way hash and safe, but bytesizes are enough signal;
      // forward the sizes, keep the hash on-disk only.
      put(props, "args_byte_size", event.argsByteSize);
      put(props, "result_byte_size", event.resultByteSize);
      break;
    case "rule.snapshot":
      // Only a count — never the rule ids (absolute paths).
      put(props, "rule_count", event.rules.length);
      break;
    case "prompt.submit":
      put(props, "tokens_approx", event.tokensApprox);
      put(props, "has_attachments", event.hasAttachments);
      break;
    case "outcome.signal":
      put(props, "outcome", event.outcome);
      // evidence (arbitrary blob) dropped.
      break;
    case "gate.decision":
      put(props, "tool_name", event.toolName);
      put(props, "decision", event.decision);
      put(props, "reason", event.reason);
      break;
  }

  return { event: `sabha.${event.kind}`, properties: props };
}

/** Exposed for tests + the doctor: which envelope fields are always safe. */
export { safeName };
