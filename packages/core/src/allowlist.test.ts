import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emailHash, isAllowed, loadAllowlist } from "./allowlist.js";

const dirs: string[] = [];
function tmpEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(resolve(tmpdir(), "sabha-al-"));
  dirs.push(dir);
  return { XDG_DATA_HOME: dir } as NodeJS.ProcessEnv;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

function listResponse(hashes: string[]): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ version: 1, hashes }), { status: 200 }),
  ) as unknown as typeof fetch;
}

const FRIEND = "friend@example.com";

describe("allowlist", () => {
  it("authorizes an email whose hash is on the list (network)", async () => {
    const env = tmpEnv();
    const d = await isAllowed(FRIEND, {
      env,
      fetchImpl: listResponse([emailHash(FRIEND)]),
    });
    expect(d.allowed).toBe(true);
    expect(d.source).toBe("network");
  });

  it("denies an email not on the list", async () => {
    const env = tmpEnv();
    const d = await isAllowed("stranger@example.com", {
      env,
      fetchImpl: listResponse([emailHash(FRIEND)]),
    });
    expect(d.allowed).toBe(false);
  });

  it("fails CLOSED when offline with no cache", async () => {
    const env = tmpEnv();
    const failing = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const d = await isAllowed(FRIEND, { env, fetchImpl: failing });
    expect(d.allowed).toBe(false);
    expect(d.source).toBe("none");
  });

  it("serves the cached list within TTL without re-fetching", async () => {
    const env = tmpEnv();
    const fetchImpl = listResponse([emailHash(FRIEND)]);
    const t0 = 1_000_000_000_000;
    await loadAllowlist({ env, fetchImpl, now: () => t0 });
    // Second call, 1 minute later: should hit cache, not the network.
    const snap = await loadAllowlist({
      env,
      fetchImpl,
      now: () => t0 + 60_000,
    });
    expect(snap.source).toBe("cache");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reads a local file:// (or plain path) source without the network", async () => {
    const env = tmpEnv();
    const dir = mkdtempSync(resolve(tmpdir(), "sabha-alf-"));
    dirs.push(dir);
    const listFile = resolve(dir, "allowlist.json");
    writeFileSync(listFile, JSON.stringify({ hashes: [emailHash(FRIEND)] }), "utf8");
    const neverFetch = vi.fn(async () => {
      throw new Error("should not hit the network for a local source");
    }) as unknown as typeof fetch;
    const d = await isAllowed(FRIEND, {
      env,
      url: listFile,
      fetchImpl: neverFetch,
    });
    expect(d.allowed).toBe(true);
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it("serves stale cache under offline grace when the network is down", async () => {
    const env = tmpEnv();
    const ok = listResponse([emailHash(FRIEND)]);
    const t0 = 1_000_000_000_000;
    await loadAllowlist({ env, fetchImpl: ok, now: () => t0 });
    const down = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    // 1 day later: TTL expired, network down, but within grace → serve stale.
    const snap = await loadAllowlist({
      env,
      fetchImpl: down,
      now: () => t0 + 24 * 60 * 60 * 1000,
    });
    expect(snap.source).toBe("grace");
    expect(snap.hashes.has(emailHash(FRIEND))).toBe(true);
  });
});
