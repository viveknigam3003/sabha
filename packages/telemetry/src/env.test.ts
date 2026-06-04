import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { loadSabhaEnv, parseDotenv } from "./env.js";

const dirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "sabha-env-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("parseDotenv", () => {
  it("parses KEY=VALUE, comments, export, and quotes", () => {
    const parsed = parseDotenv(
      [
        "# a comment",
        "",
        "SABHA_POSTHOG_KEY=phc_abc",
        'export SABHA_POSTHOG_HOST="https://eu.posthog.com"',
        "SABHA_ALLOWLIST_URL='https://example.com/a.json'",
        "NO_EQUALS_LINE",
      ].join("\n"),
    );
    expect(parsed.SABHA_POSTHOG_KEY).toBe("phc_abc");
    expect(parsed.SABHA_POSTHOG_HOST).toBe("https://eu.posthog.com");
    expect(parsed.SABHA_ALLOWLIST_URL).toBe("https://example.com/a.json");
    expect(parsed.NO_EQUALS_LINE).toBeUndefined();
  });
});

describe("loadSabhaEnv", () => {
  it("applies SABHA_* keys to a missing env but never overrides real env", () => {
    const dir = tmpDir();
    const file = resolve(dir, ".env");
    writeFileSync(
      file,
      "SABHA_POSTHOG_KEY=phc_fromfile\nSABHA_GATE_DISABLED=1\n",
      "utf8",
    );
    const env = { SABHA_GATE_DISABLED: "0" } as NodeJS.ProcessEnv;
    const res = loadSabhaEnv({ env, files: [file] });
    // real env wins:
    expect(env.SABHA_GATE_DISABLED).toBe("0");
    // gap filled:
    expect(env.SABHA_POSTHOG_KEY).toBe("phc_fromfile");
    expect(res.applied).toContain("SABHA_POSTHOG_KEY");
    expect(res.applied).not.toContain("SABHA_GATE_DISABLED");
  });

  it("ignores non-allowlisted keys (no arbitrary env injection)", () => {
    const dir = tmpDir();
    const file = resolve(dir, ".env");
    writeFileSync(file, "PATH=/evil\nSABHA_ALLOWLIST_URL=https://x\n", "utf8");
    const env = {} as NodeJS.ProcessEnv;
    loadSabhaEnv({ env, files: [file] });
    expect(env.PATH).toBeUndefined();
    expect(env.SABHA_ALLOWLIST_URL).toBe("https://x");
  });

  it("earlier files win over later files", () => {
    const dir = tmpDir();
    const a = resolve(dir, "a.env");
    const b = resolve(dir, "b.env");
    writeFileSync(a, "SABHA_POSTHOG_KEY=from_a\n", "utf8");
    writeFileSync(b, "SABHA_POSTHOG_KEY=from_b\n", "utf8");
    const env = {} as NodeJS.ProcessEnv;
    loadSabhaEnv({ env, files: [a, b] });
    expect(env.SABHA_POSTHOG_KEY).toBe("from_a");
  });
});
