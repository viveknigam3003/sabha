#!/usr/bin/env node
/**
 * Sabha Stage 2a — user key management helper.
 *
 * Usage:
 *   node scripts/gen-user-key.mjs gen <email>
 *     → prints a new API key for the user; add to SABHA_USER_KEYS
 *
 *   node scripts/gen-user-key.mjs hash <email>
 *     → prints the SHA-256 hash for the email; add to SABHA_ALLOWLIST_HASHES
 *
 * After generating a key:
 *   1. Add the key → email entry to SABHA_USER_KEYS Railway env var.
 *   2. Add the email hash to SABHA_ALLOWLIST_HASHES Railway env var.
 *   3. Redeploy. Done — the user is now allowlisted and has a working key.
 *
 * To revoke:
 *   1. Remove the key from SABHA_USER_KEYS.
 *   2. Remove the hash from SABHA_ALLOWLIST_HASHES.
 *   3. Redeploy.
 */

import { createHash, randomBytes } from "node:crypto";

const [, , cmd, email] = process.argv;

if (!cmd || !email) {
  console.error(
    "Usage: node scripts/gen-user-key.mjs <gen|hash> <email>",
  );
  process.exit(1);
}

const normalized = email.trim().toLowerCase();
const hash = createHash("sha256").update(normalized).digest("hex");

if (cmd === "hash") {
  console.log(hash);
} else if (cmd === "gen") {
  const key = `sk-${randomBytes(24).toString("hex")}`;
  console.log("");
  console.log(`Email  : ${normalized}`);
  console.log(`Hash   : ${hash}`);
  console.log(`API key: ${key}`);
  console.log("");
  console.log("─── Add to Railway env vars ───────────────────────────────────");
  console.log("");
  console.log("SABHA_USER_KEYS (merge into existing JSON object):");
  console.log(`  "${key}": "${normalized}"`);
  console.log("");
  console.log("SABHA_ALLOWLIST_HASHES (append to existing JSON array):");
  console.log(`  "${hash}"`);
  console.log("");
  console.log("Then share the API key with the user (DM / email).");
  console.log("Share the MCP config snippet from docs/remote-mcp-config.md.");
  console.log("");
} else {
  console.error(`Unknown command: ${cmd}. Use 'gen' or 'hash'.`);
  process.exit(1);
}
