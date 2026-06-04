import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

/**
 * The ONE place the user's Sabha email lives (`sabha auth <email>` writes it,
 * every general reads it). Stored in the lowest-level package so both the
 * telemetry CLI and @sabhahq/core can share the reader/writer without a circular
 * dependency. Honours XDG_CONFIG_HOME for tests.
 *
 *   ~/.config/sabha/identity.json  →  { "email": "you@example.com" }
 */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config");
  return resolve(base, "sabha");
}

export function identityFile(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(configDir(env), "identity.json");
}

export interface SabhaIdentity {
  email: string;
}

/** Synchronous read for the hot path (middleware, hook CLI). Never throws. */
export function readIdentitySync(
  env: NodeJS.ProcessEnv = process.env,
): SabhaIdentity | undefined {
  try {
    const raw = readFileSync(identityFile(env), "utf8");
    const parsed = JSON.parse(raw) as Partial<SabhaIdentity>;
    if (typeof parsed.email === "string" && parsed.email.trim().length > 0) {
      return { email: parsed.email.trim() };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Convenience: just the email, or undefined. */
export function readEmailSync(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readIdentitySync(env)?.email;
}

export async function writeIdentity(
  identity: SabhaIdentity,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const file = identityFile(env);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(identity, null, 2) + "\n", "utf8");
}
