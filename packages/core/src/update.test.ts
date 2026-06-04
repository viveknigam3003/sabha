import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, semverGt } from "./update.js";

const dirs: string[] = [];
function tmpEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(resolve(tmpdir(), "sabha-up-"));
  dirs.push(dir);
  return { XDG_DATA_HOME: dir } as NodeJS.ProcessEnv;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

function marketplace(version: string): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ metadata: { version } }), { status: 200 }),
  ) as unknown as typeof fetch;
}

describe("semverGt", () => {
  it("compares versions component-wise", () => {
    expect(semverGt("0.2.0", "0.1.0")).toBe(true);
    expect(semverGt("0.1.0", "0.1.0")).toBe(false);
    expect(semverGt("0.1.0", "0.2.0")).toBe(false);
    expect(semverGt("1.0.0", "0.9.9")).toBe(true);
  });
});

describe("checkForUpdate", () => {
  it("emits a hint when the published version is newer", async () => {
    const env = tmpEnv();
    const r = await checkForUpdate({
      env,
      currentVersion: "0.1.0",
      fetchImpl: marketplace("0.2.0"),
    });
    expect(r.updateAvailable).toBe(true);
    expect(r.hint).toContain("/plugin marketplace update");
    expect(r.checked).toBe("network");
  });

  it("no hint when already current", async () => {
    const env = tmpEnv();
    const r = await checkForUpdate({
      env,
      currentVersion: "0.2.0",
      fetchImpl: marketplace("0.2.0"),
    });
    expect(r.updateAvailable).toBe(false);
    expect(r.hint).toBeUndefined();
  });

  it("uses the daily cache instead of re-fetching", async () => {
    const env = tmpEnv();
    const fetchImpl = marketplace("0.2.0");
    const t0 = 1_000_000_000_000;
    await checkForUpdate({ env, currentVersion: "0.1.0", fetchImpl, now: () => t0 });
    const r = await checkForUpdate({
      env,
      currentVersion: "0.1.0",
      fetchImpl,
      now: () => t0 + 60_000,
    });
    expect(r.checked).toBe("cache");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails silent (no update) when offline", async () => {
    const env = tmpEnv();
    const down = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const r = await checkForUpdate({ env, currentVersion: "0.1.0", fetchImpl: down });
    expect(r.updateAvailable).toBe(false);
    expect(r.checked).toBe("skipped");
  });
});
