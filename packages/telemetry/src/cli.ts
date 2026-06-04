import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { basename, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  defaultsTelemetryConfig,
  parseTelemetryConfig,
  type TelemetryConfig,
} from "./config.js";
import {
  agentForServer,
  newSessionId,
  TELEMETRY_SCHEMA_VERSION,
  type Agent,
  type TelemetryEvent,
  type TelemetryEventInput,
} from "./event.js";
import { loadSabhaEnv } from "./env.js";
import { readEmailSync } from "./identity.js";
import { captureEvent } from "./posthog.js";
import {
  clearCurrentSession,
  ensureTelemetryDirs,
  readCurrentSessionSync,
  readSessionMeta,
  setCurrentSession,
  writeSessionMeta,
} from "./session.js";
import { telemetryRoot } from "./paths.js";
import { pruneOldSessions } from "./retention.js";
import { appendEventSync, type SyncWriteCtx } from "./syncWriter.js";

/**
 * Tiny CLI invoked by Cursor/Claude hooks. ONE binary for every Sabha general
 * (the Stage-1 consolidation; replaces argus-telemetry + narada-telemetry).
 *
 *   sabha-telemetry record <event-kind>  < stdin JSON >
 *   sabha-telemetry session-start        < stdin JSON >
 *   sabha-telemetry session-end          < stdin JSON >
 *   sabha-telemetry prune
 *   sabha-telemetry status
 *
 * Always exits 0 on telemetry-internal failures — hooks must never block agent
 * work because telemetry is unhappy.
 */
export async function runCli(argv: string[]): Promise<number> {
  // Pull config from `.env` files (process.env still wins) before anything
  // reads SABHA_* knobs.
  loadSabhaEnv();
  const [verb, ...rest] = argv;
  try {
    switch (verb) {
      case "session-start":
        return await cmdSessionStart(readStdinJsonSync());
      case "session-end":
        return await cmdSessionEnd(readStdinJsonSync());
      case "record": {
        const kind = rest[0];
        if (!kind) {
          warn("missing event kind: sabha-telemetry record <kind>");
          return 0;
        }
        return await cmdRecord(kind, readStdinJsonSync());
      }
      case "prune":
        return await cmdPrune();
      case "status":
        return cmdStatus();
      case undefined:
      case "--help":
      case "-h":
        printUsage();
        return 0;
      default:
        warn(`unknown verb: ${verb}`);
        printUsage();
        return 0;
    }
  } catch (err) {
    warn(`unexpected error: ${(err as Error).message}`);
    return 0;
  }
}

function printUsage(): void {
  process.stderr.write(
    [
      "sabha-telemetry — host-side recorder used by Cursor/Claude hooks",
      "",
      "usage:",
      "  sabha-telemetry session-start  < stdin: sessionStart hook json",
      "  sabha-telemetry session-end    < stdin: sessionEnd hook json",
      "  sabha-telemetry record <kind>  < stdin: hook json",
      "  sabha-telemetry prune",
      "  sabha-telemetry status",
      "",
    ].join("\n"),
  );
}

function readStdinJsonSync(): Record<string, unknown> {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return {};
  }
  if (!raw || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function warn(msg: string): void {
  process.stderr.write(`sabha-telemetry: ${msg}\n`);
}

/**
 * Records an event to the JSONL stream AND mirrors it (redacted) to PostHog.
 * The hook process is short-lived, so we AWAIT the PostHog POST (with its own
 * internal timeout) — otherwise the process would exit before the request
 * flushed. Fail-silent throughout.
 */
async function recordAndMirror(
  input: TelemetryEventInput,
  ctx: SyncWriteCtx,
  cfg: TelemetryConfig,
): Promise<void> {
  const enveloped = appendEventSync(input, ctx);
  if (!enveloped) return;
  if (!cfg.posthog.enabled) return;
  await mirror(enveloped, ctx.env);
}

async function mirror(
  event: TelemetryEvent,
  env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
  try {
    const email = readEmailSync(env ?? process.env);
    await captureEvent(event, { email }, { env: env ?? process.env });
  } catch {
    // never throw
  }
}

async function cmdSessionStart(
  payload: Record<string, unknown>,
): Promise<number> {
  await ensureTelemetryDirs();
  const sessionId = newSessionId();
  await setCurrentSession(sessionId);

  const host = stringField(payload, "client") ?? "cursor";
  const cwd = stringField(payload, "cwd") ?? process.cwd();
  const gitBranch = detectGitBranch(cwd);
  const startedAt = new Date().toISOString();
  const cfg = loadConfigFromYamlSafe();

  await writeSessionMeta({
    sessionId,
    startedAt,
    host,
    cwd,
    ...(gitBranch !== undefined ? { gitBranch } : {}),
    source: "hook",
  });

  // session.start is a host-level lifecycle event → agent "sabha".
  await recordAndMirror(
    {
      kind: "session.start",
      host,
      cwd,
      ...(gitBranch !== undefined ? { gitBranch } : {}),
    },
    { sessionId, source: "hook", agent: "sabha" },
    cfg,
  );

  const rules = collectActiveRules(cwd);
  if (rules.length > 0) {
    await recordAndMirror(
      { kind: "rule.snapshot", rules },
      { sessionId, source: "hook", agent: "sabha" },
      cfg,
    );
  }

  process.stdout.write(
    JSON.stringify({ sessionId, telemetryRoot: telemetryRoot() }) + "\n",
  );
  return 0;
}

async function cmdSessionEnd(
  _payload: Record<string, unknown>,
): Promise<number> {
  const sessionId = readCurrentSessionSync();
  if (!sessionId) return 0;
  const cfg = loadConfigFromYamlSafe();

  const meta = await readSessionMeta(sessionId);
  const startedAt = meta?.startedAt ? Date.parse(meta.startedAt) : NaN;
  const durationMs = Number.isFinite(startedAt)
    ? Math.max(0, Date.now() - startedAt)
    : 0;

  await recordAndMirror(
    { kind: "session.end", durationMs },
    { sessionId, source: "hook", agent: "sabha" },
    cfg,
  );

  await pruneOldSessions(cfg.retentionDays);
  await clearCurrentSession();
  return 0;
}

async function cmdRecord(
  kind: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const sessionId = readCurrentSessionSync();
  if (!sessionId) return 0;
  const cfg = loadConfigFromYamlSafe();
  const baseCtx = { sessionId, source: "hook" as const };

  switch (kind) {
    case "skill.invoke": {
      const skillName =
        stringField(payload, "skill_name") ?? stringField(payload, "name");
      if (!skillName) return 0;
      const skillPath = stringField(payload, "skill_path");
      await recordAndMirror(
        {
          kind: "skill.invoke",
          skillName,
          ...(skillPath !== undefined ? { skillPath } : {}),
          origin: "unknown",
        },
        { ...baseCtx, agent: inferAgentFromText(skillPath ?? skillName) },
        cfg,
      );
      return 0;
    }
    case "skill.read-probe": {
      // Cursor has no first-class Skill tool — skills load when the agent
      // calls Read on a SKILL.md. We hang off preToolUse{matcher:"Read"}.
      const path = extractToolPath(payload);
      if (!path || !/(?:^|\/)SKILL\.md$/i.test(path)) return 0;
      const skillName = basename(path.replace(/\/+SKILL\.md$/i, ""));
      if (!skillName || skillName === "" || skillName === ".") return 0;
      await recordAndMirror(
        {
          kind: "skill.invoke",
          skillName,
          skillPath: path,
          origin: inferSkillOrigin(path),
        },
        { ...baseCtx, agent: inferAgentFromText(path) },
        cfg,
      );
      return 0;
    }
    case "subagent.start": {
      const subagentType =
        stringField(payload, "subagent_type") ??
        stringField(payload, "type") ??
        "unknown";
      const description = stringField(payload, "description");
      const model = stringField(payload, "model");
      const runInBackground = booleanField(payload, "run_in_background");
      await recordAndMirror(
        {
          kind: "subagent.start",
          subagentType,
          ...(description !== undefined ? { description } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(runInBackground !== undefined ? { runInBackground } : {}),
        },
        { ...baseCtx, agent: inferAgentFromSubagent(subagentType) },
        cfg,
      );
      return 0;
    }
    case "subagent.stop": {
      const subagentType =
        stringField(payload, "subagent_type") ??
        stringField(payload, "type") ??
        "unknown";
      const exitReason = stringField(payload, "exit_reason");
      await recordAndMirror(
        {
          kind: "subagent.stop",
          subagentType,
          ...(exitReason
            ? {
                exitReason:
                  exitReason === "completed" ||
                  exitReason === "cancelled" ||
                  exitReason === "failed"
                    ? exitReason
                    : "unknown",
              }
            : {}),
        },
        { ...baseCtx, agent: inferAgentFromSubagent(subagentType) },
        cfg,
      );
      return 0;
    }
    case "tool.call": {
      const toolName = stringField(payload, "tool_name");
      if (!toolName) return 0;
      const server = stringField(payload, "server") ?? inferServer(toolName);
      const success = booleanField(payload, "success") ?? true;
      const errorCode = stringField(payload, "error_code");
      await recordAndMirror(
        {
          kind: "tool.call",
          server,
          toolName,
          success,
          ...(errorCode !== undefined ? { errorCode } : {}),
        },
        { ...baseCtx, agent: agentForServer(server) },
        cfg,
      );
      return 0;
    }
    case "prompt.submit": {
      await recordAndMirror(
        {
          kind: "prompt.submit",
          ...(numberField(payload, "tokens_approx") !== undefined
            ? { tokensApprox: numberField(payload, "tokens_approx")! }
            : {}),
          ...(booleanField(payload, "has_attachments") !== undefined
            ? { hasAttachments: booleanField(payload, "has_attachments")! }
            : {}),
        },
        { ...baseCtx, agent: "sabha" },
        cfg,
      );
      return 0;
    }
    default:
      warn(`unknown event kind: ${kind}`);
      return 0;
  }
}

async function cmdPrune(): Promise<number> {
  const cfg = loadConfigFromYamlSafe();
  const out = await pruneOldSessions(cfg.retentionDays);
  process.stdout.write(JSON.stringify(out) + "\n");
  return 0;
}

function cmdStatus(): number {
  const cfg = loadConfigFromYamlSafe();
  process.stdout.write(
    JSON.stringify({
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      telemetryRoot: telemetryRoot(),
      currentSessionId: readCurrentSessionSync() ?? null,
      identityEmail: readEmailSync() ? "set" : "unset",
      config: {
        enabled: cfg.enabled,
        retentionDays: cfg.retentionDays,
        posthog: cfg.posthog.enabled,
      },
    }) + "\n",
  );
  return 0;
}

function stringField(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function numberField(
  payload: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = payload[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function booleanField(
  payload: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const v = payload[key];
  return typeof v === "boolean" ? v : undefined;
}

function inferServer(toolName: string): string {
  const idx = toolName.indexOf("__");
  if (idx > 0) return toolName.slice(0, idx);
  return "unknown";
}

/** Heuristic agent attribution from a path/name (skill files, etc.). */
function inferAgentFromText(text: string): Agent {
  const t = text.toLowerCase();
  if (t.includes("argus")) return "argus";
  if (t.includes("narada")) return "narada";
  return "sabha";
}

/** Map a subagent type to the owning general where we know the mapping. */
function inferAgentFromSubagent(subagentType: string): Agent {
  const t = subagentType.toLowerCase();
  if (t.includes("data-engineer") || t.includes("argus")) return "argus";
  if (
    t.includes("comms-curator") ||
    t.includes("narada") ||
    t.includes("messenger")
  ) {
    return "narada";
  }
  return "sabha";
}

function detectGitBranch(cwd: string): string | undefined {
  try {
    const out = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    });
    const branch = out.trim();
    return branch.length > 0 && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

function loadConfigFromYamlSafe(): TelemetryConfig {
  const override = process.env["SABHA_TELEMETRY_CONFIG_JSON"];
  if (override) {
    try {
      return parseTelemetryConfig(JSON.parse(override));
    } catch {
      // fall through
    }
  }
  try {
    const yaml = readConfigYamlSafe();
    if (yaml && typeof yaml === "object" && "telemetry" in yaml) {
      return parseTelemetryConfig(
        (yaml as Record<string, unknown>)["telemetry"],
      );
    }
  } catch {
    // fall through to defaults
  }
  return defaultsTelemetryConfig();
}

function extractToolPath(payload: Record<string, unknown>): string | undefined {
  const input = (payload["tool_input"] ?? {}) as Record<string, unknown>;
  return (
    stringField(input, "target_file") ??
    stringField(input, "path") ??
    stringField(input, "file_path") ??
    stringField(payload, "target_file") ??
    stringField(payload, "path") ??
    stringField(payload, "file_path")
  );
}

function inferSkillOrigin(
  path: string,
): "plugin" | "user" | "builtin" | "unknown" {
  if (path.includes("/plugins/cache/")) return "plugin";
  const home = process.env["HOME"];
  if (home && path.startsWith(home)) return "user";
  return "unknown";
}

function collectActiveRules(
  cwd: string,
): Array<{ id: string; origin: "plugin" | "user" | "project" | "unknown" }> {
  const home = process.env["HOME"] ?? "";
  const out: Array<{
    id: string;
    origin: "plugin" | "user" | "project" | "unknown";
  }> = [];
  const seen = new Set<string>();

  const addFile = (
    path: string,
    origin: "plugin" | "user" | "project" | "unknown",
  ) => {
    try {
      statSync(path);
    } catch {
      return;
    }
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ id: path, origin });
  };

  const addDirMdc = (
    dir: string,
    origin: "plugin" | "user" | "project" | "unknown",
  ) => {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry.endsWith(".mdc") || entry === "AGENTS.md") {
          addFile(resolve(dir, entry), origin);
        }
      }
    } catch {
      // missing dir — skip
    }
  };

  const walkPluginCacheForRules = (dir: string, depth: number) => {
    if (depth <= 0) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = resolve(dir, entry.name);
      if (entry.name === "rules") {
        addDirMdc(full, "plugin");
      } else {
        walkPluginCacheForRules(full, depth - 1);
      }
    }
  };

  const addPluginCacheRules = (cacheRoot: string) => {
    walkPluginCacheForRules(cacheRoot, 8);
  };

  if (home) {
    addDirMdc(resolve(home, ".cursor", "rules"), "user");
    addFile(resolve(home, ".cursor", "AGENTS.md"), "user");
    addFile(resolve(home, ".claude", "CLAUDE.md"), "user");
    addPluginCacheRules(resolve(home, ".cursor", "plugins", "cache"));
    addPluginCacheRules(resolve(home, ".claude", "plugins", "cache"));
  }
  addDirMdc(resolve(cwd, ".cursor", "rules"), "project");
  addFile(resolve(cwd, "AGENTS.md"), "project");
  addFile(resolve(cwd, "CLAUDE.md"), "project");
  addPluginCacheRules(resolve(cwd, ".cursor", "plugins", "cache"));

  return out;
}

function readConfigYamlSafe(): unknown {
  try {
    const env = process.env;
    const home = env.HOME ?? "";
    const path =
      env.SABHA_CONFIG_FILE ??
      resolve(
        env.XDG_CONFIG_HOME ?? resolve(home, ".config"),
        "sabha",
        "config.yaml",
      );
    const raw = readFileSync(path, "utf8");
    return parseYaml(raw);
  } catch {
    return undefined;
  }
}
