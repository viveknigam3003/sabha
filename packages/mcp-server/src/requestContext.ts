import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { RemoteRequestContext } from "@sabhahq/core";

/**
 * Returns the server-side per-user data directory base (XDG_CONFIG_HOME
 * override). Layout:
 *
 *   ${SABHA_DATA_ROOT}/<email-sha256>/.config   ← argus + narada config + registry
 *
 * Defaults to `~/.local/share/sabha-server` when SABHA_DATA_ROOT is unset.
 */
function serverDataRoot(): string {
  return (
    process.env.SABHA_DATA_ROOT ??
    resolve(homedir(), ".local", "share", "sabha-server")
  );
}

/**
 * Builds a deterministic per-user config home from their email hash.
 * The hash is the same SHA-256 used by the allowlist — keeps the directory
 * name opaque (no PII in filesystem paths).
 */
function configHomeForEmail(email: string): string {
  const hash = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
  return resolve(serverDataRoot(), hash, ".config");
}

/**
 * Assembles a per-request context from the resolved email + HTTP headers.
 * Provider creds are extracted from well-known X-* headers; only the data
 * actually present in the headers is included (no defaults are invented).
 *
 * Headers:
 *   X-NR-API-KEY       → New Relic user API key
 *   X-NR-ACCOUNT-ID    → New Relic default account ID (integer string)
 *   X-REDASH-URL       → Redash instance URL
 *   X-REDASH-API-KEY   → Redash API key
 */
export function buildRequestContext(
  email: string,
  headers: Record<string, string | string[] | undefined>,
): RemoteRequestContext {
  const get = (name: string): string | undefined => {
    const v = headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };

  const nrAccountRaw = get("x-nr-account-id");
  const nrAccountId =
    nrAccountRaw !== undefined ? parseInt(nrAccountRaw, 10) : undefined;

  return {
    email,
    configHome: configHomeForEmail(email),
    nrApiKey: get("x-nr-api-key"),
    nrAccountId:
      nrAccountId !== undefined && !isNaN(nrAccountId)
        ? nrAccountId
        : undefined,
    redashUrl: get("x-redash-url"),
    redashApiKey: get("x-redash-api-key"),
  };
}
