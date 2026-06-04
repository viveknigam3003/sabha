export {
  SabhaError,
  NotAuthorizedError,
  NotRegisteredError,
} from "./errors.js";
export {
  emailHash,
  isAllowed,
  loadAllowlist,
  DEFAULT_ALLOWLIST_URL,
  type AllowlistDecision,
  type AllowlistOptions,
  type AllowlistSnapshot,
  type AllowlistSource,
} from "./allowlist.js";
export {
  createGate,
  type Gate,
  type GateDecision,
  type GateOptions,
  type GuardContext,
} from "./gate.js";
export {
  identityFile,
  isValidEmail,
  normalizeEmail,
  readEmailSync,
  readIdentitySync,
  registerEmail,
} from "./auth.js";
export {
  checkForUpdate,
  semverGt,
  SABHA_VERSION,
  DEFAULT_MARKETPLACE_URL,
  type UpdateOptions,
  type UpdateResult,
} from "./update.js";
export {
  allowlistCacheFile,
  configDir,
  dataRoot,
  updateCheckFile,
} from "./paths.js";
export { loadSabhaEnv, parseDotenv } from "@sabhahq/telemetry";
export { runCli } from "./cli.js";
