import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emailHash } from "./allowlist.js";
import { registerEmail } from "./auth.js";
import { createGate } from "./gate.js";
import { NotAuthorizedError, NotRegisteredError } from "./errors.js";

const dirs: string[] = [];
function tmpEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(resolve(tmpdir(), "sabha-gate-"));
  dirs.push(dir);
  return {
    XDG_DATA_HOME: dir,
    XDG_CONFIG_HOME: dir,
    ...extra,
  } as NodeJS.ProcessEnv;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

function listResponse(hashes: string[]): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ hashes }), { status: 200 }),
  ) as unknown as typeof fetch;
}

const FRIEND = "friend@example.com";
const ctx = { agent: "argus" as const, toolName: "argus__run_query" };
const handler = async () => "ran";

describe("gate.guard", () => {
  it("refuses with NotRegisteredError when no email is set", async () => {
    const env = tmpEnv();
    const gate = createGate({ env, fetchImpl: listResponse([]) });
    const guarded = gate.guard(ctx, handler);
    await expect(guarded({})).rejects.toBeInstanceOf(NotRegisteredError);
  });

  it("refuses with NotAuthorizedError when email is not allowlisted", async () => {
    const env = tmpEnv();
    await registerEmail(FRIEND, env);
    const gate = createGate({ env, fetchImpl: listResponse([]) });
    await expect(gate.guard(ctx, handler)({})).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  it("runs the handler when email is allowlisted", async () => {
    const env = tmpEnv();
    await registerEmail(FRIEND, env);
    const gate = createGate({
      env,
      fetchImpl: listResponse([emailHash(FRIEND)]),
    });
    await expect(gate.guard(ctx, handler)({})).resolves.toBe("ran");
  });

  it("honours the SABHA_GATE_DISABLED escape hatch", async () => {
    const env = tmpEnv({ SABHA_GATE_DISABLED: "1" });
    const gate = createGate({ env, fetchImpl: listResponse([]) });
    await expect(gate.guard(ctx, handler)({})).resolves.toBe("ran");
  });
});
