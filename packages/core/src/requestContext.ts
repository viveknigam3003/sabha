import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context stored in AsyncLocalStorage for the remote MCP server.
 * Set once per HTTP request by the auth + context middleware; read by
 * makeDeps() and createGate() so they can operate without global state.
 *
 * Falls back gracefully: if getRemoteContext() returns undefined, each
 * subsystem uses its original local-mode path (disk reads, process.env).
 * This keeps Stage-1 stdio mode working unchanged.
 */
export interface RemoteRequestContext {
  /** Resolved from the bearer token via SABHA_USER_KEYS map. */
  email: string;

  /**
   * Per-user config home on the server. Passed as XDG_CONFIG_HOME so that
   * argus + narada path helpers route to the right per-user directory.
   * e.g. `${SABHA_DATA_ROOT}/<email-hash>/.config`
   */
  configHome: string;

  // ── Argus provider creds (from request headers) ────────────────────────
  /** X-NR-API-KEY header. Injected into synthetic env as the NR API key. */
  nrApiKey?: string | undefined;
  /** X-NR-ACCOUNT-ID header. Used as the default NR account ID. */
  nrAccountId?: number | undefined;
  /** X-REDASH-URL header. */
  redashUrl?: string | undefined;
  /** X-REDASH-API-KEY header. */
  redashApiKey?: string | undefined;
}

const _als = new AsyncLocalStorage<RemoteRequestContext>();

/**
 * Run `fn` with the given remote context available for the duration of the
 * call (and all async continuations within it). Used by the HTTP request
 * handler in the mcp-server package.
 */
export function runWithRemoteContext<T>(
  ctx: RemoteRequestContext,
  fn: () => T,
): T {
  return _als.run(ctx, fn);
}

/**
 * Returns the current remote request context, or undefined when running in
 * local stdio mode (no active AsyncLocalStorage context).
 */
export function getRemoteContext(): RemoteRequestContext | undefined {
  return _als.getStore();
}
