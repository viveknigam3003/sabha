import { loadSabhaEnv, readEmailSync, telemetryRoot } from "@sabhahq/telemetry";
import { isAllowed } from "./allowlist.js";
import { registerEmail } from "./auth.js";
import { SabhaError } from "./errors.js";
import { checkForUpdate, SABHA_VERSION } from "./update.js";

/**
 * The `sabha` helper CLI. Setup/help verbs only — deliberately UNGATED so a
 * brand-new user can always bootstrap:
 *
 *   sabha auth <email>     store the Sabha email (identity + gate + telemetry)
 *   sabha doctor           readiness rollup (email, allowlist, telemetry)
 *   sabha update-check      print an update hint if a newer version exists
 *
 * Always exits 0 in hook-ish contexts; `auth`/`doctor` return non-zero on hard
 * user error so a human running it sees the failure.
 */
export async function runCli(argv: string[]): Promise<number> {
  loadSabhaEnv();
  const [verb, ...rest] = argv;
  switch (verb) {
    case "auth":
      return cmdAuth(rest);
    case "doctor":
    case "status":
      return cmdDoctor();
    case "update-check":
      return cmdUpdateCheck();
    case undefined:
    case "--help":
    case "-h":
      printUsage();
      return 0;
    default:
      process.stderr.write(`sabha: unknown command "${verb}"\n`);
      printUsage();
      return 1;
  }
}

function printUsage(): void {
  process.stdout.write(
    [
      `sabha v${SABHA_VERSION} — shared Sabha runtime CLI`,
      "",
      "usage:",
      "  sabha auth <email>     register your Sabha email (one-time)",
      "  sabha doctor           show readiness (email, allowlist, telemetry)",
      "  sabha update-check     print an update hint if a newer version exists",
      "",
    ].join("\n"),
  );
}

async function cmdAuth(rest: string[]): Promise<number> {
  const email = rest[0];
  if (!email) {
    process.stderr.write("sabha auth: missing <email>\n");
    return 1;
  }
  try {
    const { email: stored, file } = await registerEmail(email);
    process.stdout.write(`Registered ${stored}\nStored at ${file}\n`);
    // Surface the gate decision immediately so the user knows if they're in.
    const decision = await isAllowed(stored);
    if (decision.allowed) {
      process.stdout.write("Allowlist: authorized ✓\n");
    } else if (decision.source === "none") {
      process.stdout.write(
        "Allowlist: could not be reached (offline). Access will be confirmed when you're back online.\n",
      );
    } else {
      process.stdout.write(
        "Allowlist: not yet authorized. Ask the maintainer to add your email.\n",
      );
    }
    return 0;
  } catch (err) {
    if (err instanceof SabhaError) {
      process.stderr.write(`${err.code}: ${err.message}\n`);
    } else {
      process.stderr.write(`sabha auth: ${(err as Error).message}\n`);
    }
    return 1;
  }
}

async function cmdDoctor(): Promise<number> {
  // Re-run the loader to report which .env files contributed config.
  const envLoad = loadSabhaEnv({ force: true });
  const email = readEmailSync();
  let allowlist: { allowed: boolean; source: string; reason: string } | null =
    null;
  if (email) {
    const d = await isAllowed(email);
    allowlist = { allowed: d.allowed, source: d.source, reason: d.reason };
  }
  const out = {
    version: SABHA_VERSION,
    email: email ?? null,
    registered: Boolean(email),
    allowlist,
    telemetryRoot: telemetryRoot(),
    envFilesLoaded: envLoad.loaded,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  return 0;
}

async function cmdUpdateCheck(): Promise<number> {
  try {
    const result = await checkForUpdate();
    // The sessionStart hook surfaces stdout — print ONLY when there's a hint,
    // so a fresh/offline run stays silent.
    if (result.updateAvailable && result.hint) {
      process.stdout.write(result.hint + "\n");
    }
  } catch {
    // fail-silent
  }
  return 0;
}
