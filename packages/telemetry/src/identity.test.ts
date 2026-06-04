import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { identityFile, readEmailSync, writeIdentity } from "./identity.js";

const dirs: string[] = [];
function tmpEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(resolve(tmpdir(), "sabha-id-"));
  dirs.push(dir);
  return { XDG_CONFIG_HOME: dir } as NodeJS.ProcessEnv;
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("identity store", () => {
  it("round-trips the email and lands in ~/.config/sabha", async () => {
    const env = tmpEnv();
    expect(readEmailSync(env)).toBeUndefined();
    await writeIdentity({ email: "friend@example.com" }, env);
    expect(identityFile(env)).toMatch(/sabha\/identity\.json$/);
    expect(readEmailSync(env)).toBe("friend@example.com");
  });

  it("returns undefined for a malformed file", () => {
    const env = tmpEnv();
    expect(readEmailSync(env)).toBeUndefined();
  });
});
