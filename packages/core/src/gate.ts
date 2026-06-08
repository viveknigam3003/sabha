import { emitEvent, readEmailSync, type Agent } from "@sabhahq/telemetry";
import {
  isAllowed,
  type AllowlistOptions,
  type AllowlistSource,
} from "./allowlist.js";
import { NotAuthorizedError, NotRegisteredError } from "./errors.js";

/**
 * The shared MCP tool guard. ONE implementation used by every general's
 * `registerTools` to wrap PRIVILEGED tools; setup/help tools (`sabha auth`,
 * doctor/status) stay ungated so a brand-new user can always bootstrap.
 *
 * The authorization decision is memoized for the process lifetime, so the
 * per-call cost is a Set lookup — no network, no disk, no latency. (Stage 2's
 * remote MCP revisits this with instant server-side revoke.)
 */
export interface GateOptions extends AllowlistOptions {
  /**
   * Override for resolving the current user's email. When provided (remote
   * server mode), this is called instead of reading from
   * `~/.config/sabha/identity.json`. Return undefined to fall back to the
   * local identity file path. Must return a pre-validated email string.
   */
  getEmail?: () => string | undefined;
}

export interface GuardContext {
  /** Which general owns the tool (for the gate.decision telemetry row). */
  agent: Agent;
  toolName: string;
}

export interface GateDecision {
  allowed: boolean;
  email?: string;
  reason: string;
  source: AllowlistSource | "no-email" | "disabled";
  code?: string;
}

export interface Gate {
  /** Resolve (memoized) whether the current user may call privileged tools. */
  authorize(): Promise<GateDecision>;
  /** Wrap a privileged tool handler. Throws a typed error on refusal. */
  guard<TArgs, TResult>(
    ctx: GuardContext,
    handler: (args: TArgs) => Promise<TResult>,
  ): (args: TArgs) => Promise<TResult>;
  /** Test-only: drop the memoized decision. */
  reset(): void;
}

function gateDisabled(env: NodeJS.ProcessEnv): boolean {
  return env.SABHA_GATE_DISABLED === "1" || env.SABHA_GATE_DISABLED === "true";
}

export function createGate(opts: GateOptions = {}): Gate {
  const env = opts.env ?? process.env;
  let cached: Promise<GateDecision> | undefined;

  async function compute(): Promise<GateDecision> {
    // Dev/maintainer escape hatch — local-only, never set in shipped configs.
    if (gateDisabled(env)) {
      return { allowed: true, reason: "gate disabled via env", source: "disabled" };
    }

    // In server mode, email is resolved from the bearer token by the HTTP
    // middleware and injected via opts.getEmail(). In stdio mode, fall back
    // to the local identity file.
    const email = opts.getEmail ? opts.getEmail() : readEmailSync(env);
    if (!email) {
      return {
        allowed: false,
        reason: "no Sabha email registered",
        source: "no-email",
        code: "SABHA_NOT_REGISTERED",
      };
    }

    const decision = await isAllowed(email, opts);
    return {
      allowed: decision.allowed,
      email,
      reason: decision.reason,
      source: decision.source,
      ...(decision.allowed ? {} : { code: "SABHA_NOT_AUTHORIZED" }),
    };
  }

  function authorize(): Promise<GateDecision> {
    if (!cached) cached = compute();
    return cached;
  }

  function guard<TArgs, TResult>(
    ctx: GuardContext,
    handler: (args: TArgs) => Promise<TResult>,
  ): (args: TArgs) => Promise<TResult> {
    return async (args: TArgs): Promise<TResult> => {
      const decision = await authorize();
      if (decision.allowed) {
        return handler(args);
      }
      // Record the refusal (redacted; carries no email, just the decision).
      try {
        emitEvent(
          {
            kind: "gate.decision",
            toolName: ctx.toolName,
            decision: "deny",
            reason: decision.reason,
          },
          ctx.agent,
        );
      } catch {
        // never throw out of the guard for telemetry reasons
      }
      throw decision.code === "SABHA_NOT_REGISTERED"
        ? new NotRegisteredError()
        : new NotAuthorizedError();
    };
  }

  function reset(): void {
    cached = undefined;
  }

  return { authorize, guard, reset };
}
