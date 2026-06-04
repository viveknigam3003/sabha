import {
  identityFile,
  readEmailSync,
  readIdentitySync,
  writeIdentity,
} from "@sabhahq/telemetry";
import { SabhaError } from "./errors.js";

export { identityFile, readEmailSync, readIdentitySync } from "@sabhahq/telemetry";

// Pragmatic email shape check — not RFC 5322, just enough to catch typos.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(normalizeEmail(email));
}

/**
 * Stores the user's Sabha email once in ~/.config/sabha/identity.json. This is
 * the SINGLE place every general reads identity from (telemetry distinct_id +
 * allowlist gate). Stable command name — becomes a real login in Stage 2.
 */
export async function registerEmail(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ email: string; file: string }> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new SabhaError(
      "SABHA_INVALID_EMAIL",
      `"${email}" doesn't look like a valid email address.`,
    );
  }
  await writeIdentity({ email: normalized }, env);
  return { email: normalized, file: identityFile(env) };
}
