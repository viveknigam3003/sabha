/**
 * API key authentication for the Sabha remote MCP server.
 *
 * SABHA_USER_KEYS env var is a JSON object mapping API key → email.
 * Each user gets a unique opaque key; the server uses it to resolve their
 * email for gate + telemetry. Keys are distributed manually (Stage 2a).
 *
 * Example:
 *   SABHA_USER_KEYS='{"sk-abc123":"alice@example.com","sk-def456":"bob@example.com"}'
 */

let _keyMap: Map<string, string> | undefined;

function getKeyMap(): Map<string, string> {
  if (_keyMap) return _keyMap;
  const raw = process.env.SABHA_USER_KEYS;
  if (!raw) {
    _keyMap = new Map();
    return _keyMap;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      console.error("[sabha-mcp-server] SABHA_USER_KEYS is not a JSON object");
      _keyMap = new Map();
      return _keyMap;
    }
    _keyMap = new Map(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k, v as string]),
    );
    return _keyMap;
  } catch (err) {
    console.error("[sabha-mcp-server] Failed to parse SABHA_USER_KEYS:", err);
    _keyMap = new Map();
    return _keyMap;
  }
}

/**
 * Extracts the bearer token from the Authorization header.
 * Returns undefined when the header is absent or malformed.
 */
export function extractBearerToken(
  authHeader: string | undefined,
): string | undefined {
  if (!authHeader) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  return match?.[1];
}

/**
 * Resolves an API key to the associated email address.
 * Returns undefined when the key is unknown (→ 401).
 */
export function resolveEmail(apiKey: string): string | undefined {
  return getKeyMap().get(apiKey);
}

/** Test-only: reset the cached key map so tests can inject a fresh env. */
export function resetKeyMapForTests(): void {
  _keyMap = undefined;
}
