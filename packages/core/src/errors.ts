/**
 * Typed errors. Like the other generals, every Sabha error carries a stable
 * `code` so the host agent (and the telemetry middleware's `classifyError`)
 * can bucket failures without parsing prose. Surface `code: message` verbatim.
 */
export class SabhaError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SabhaError";
    this.code = code;
  }
}

/** No email registered yet — the user must run `sabha auth <email>`. */
export class NotRegisteredError extends SabhaError {
  constructor(
    message = "No Sabha email registered. Run `sabha auth <email>` to register, then retry.",
  ) {
    super("SABHA_NOT_REGISTERED", message);
    this.name = "NotRegisteredError";
  }
}

/** Email registered but not on the allowlist (fail-closed). */
export class NotAuthorizedError extends SabhaError {
  constructor(
    message = "This Sabha account is not authorized. Ask the maintainer to add your email to the allowlist.",
  ) {
    super("SABHA_NOT_AUTHORIZED", message);
    this.name = "NotAuthorizedError";
  }
}
