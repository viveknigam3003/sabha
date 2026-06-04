#!/usr/bin/env node
/**
 * Maintain the Sabha email allowlist (the JSON served at SABHA_ALLOWLIST_URL).
 *
 * The list stores SHA-256 hashes — NEVER raw emails — so the source can be
 * world-readable without leaking who's registered. The hash MUST match the
 * runtime gate's `emailHash` in @sabhahq/core:
 *     sha256( email.trim().toLowerCase() )  → hex
 *
 * Usage:
 *   node scripts/allowlist.mjs add <email> [more emails...]
 *   node scripts/allowlist.mjs remove <email> [more emails...]
 *   node scripts/allowlist.mjs has <email>
 *   node scripts/allowlist.mjs list
 *
 * The file defaults to ./allowlist.json (override with SABHA_ALLOWLIST_FILE or
 * --file <path>). Approve = add; revoke = remove; then publish the file to
 * wherever SABHA_ALLOWLIST_URL points.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Same normalization + shape check the runtime auth uses (@sabhahq/core's
// isValidEmail / emailHash), so what you add here is exactly what the gate
// recognizes and rejects the same typos `sabha auth` would.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function isValidEmail(email) {
  return EMAIL_RE.test(normalizeEmail(email));
}

function emailHash(email) {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

function parseArgs(argv) {
  const out = { file: undefined, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file" || argv[i] === "-f") {
      out.file = argv[++i];
    } else {
      out.rest.push(argv[i]);
    }
  }
  return out;
}

function resolveFile(flagFile) {
  const p = flagFile ?? process.env.SABHA_ALLOWLIST_FILE ?? "allowlist.json";
  return resolve(process.cwd(), p);
}

function loadDoc(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const hashes = Array.isArray(parsed.hashes) ? parsed.hashes : [];
    return { version: parsed.version ?? 1, hashes: hashes.map(String) };
  } catch {
    return { version: 1, hashes: [] };
  }
}

function saveDoc(file, doc) {
  const unique = [...new Set(doc.hashes.map((h) => h.toLowerCase()))].sort();
  writeFileSync(
    file,
    JSON.stringify({ version: doc.version ?? 1, hashes: unique }, null, 2) + "\n",
    "utf8",
  );
  return unique.length;
}

function usage() {
  process.stdout.write(
    [
      "sabha allowlist — manage the hashed email allowlist",
      "",
      "  node scripts/allowlist.mjs add <email> [more...]",
      "  node scripts/allowlist.mjs remove <email> [more...]",
      "  node scripts/allowlist.mjs has <email>",
      "  node scripts/allowlist.mjs list",
      "",
      "  --file <path>   allowlist json (default ./allowlist.json or $SABHA_ALLOWLIST_FILE)",
      "",
    ].join("\n"),
  );
}

function main() {
  const { file: flagFile, rest } = parseArgs(process.argv.slice(2));
  const [cmd, ...emails] = rest;
  const file = resolveFile(flagFile);

  if (!cmd || cmd === "--help" || cmd === "-h") {
    usage();
    return 0;
  }

  const doc = loadDoc(file);
  const set = new Set(doc.hashes.map((h) => h.toLowerCase()));

  switch (cmd) {
    case "add": {
      if (emails.length === 0) {
        process.stderr.write("add: provide at least one email\n");
        return 1;
      }
      let invalid = 0;
      for (const email of emails) {
        if (!isValidEmail(email)) {
          invalid++;
          process.stderr.write(`✗ invalid email, skipped: ${email}\n`);
          continue;
        }
        const h = emailHash(email);
        if (set.has(h)) {
          process.stdout.write(`= already present: ${email} (${h.slice(0, 12)}…)\n`);
        } else {
          set.add(h);
          process.stdout.write(`+ added: ${email} (${h.slice(0, 12)}…)\n`);
        }
      }
      const count = saveDoc(file, { version: doc.version, hashes: [...set] });
      process.stdout.write(`\nwrote ${count} hashes → ${file}\n`);
      return invalid > 0 ? 1 : 0;
    }
    case "remove":
    case "rm": {
      if (emails.length === 0) {
        process.stderr.write("remove: provide at least one email\n");
        return 1;
      }
      for (const email of emails) {
        const h = emailHash(email);
        if (set.delete(h)) {
          process.stdout.write(`- removed: ${email} (${h.slice(0, 12)}…)\n`);
        } else {
          process.stdout.write(`? not found: ${email} (${h.slice(0, 12)}…)\n`);
        }
      }
      const count = saveDoc(file, { version: doc.version, hashes: [...set] });
      process.stdout.write(`\nwrote ${count} hashes → ${file}\n`);
      return 0;
    }
    case "has": {
      const email = emails[0];
      if (!email) {
        process.stderr.write("has: provide an email\n");
        return 1;
      }
      const present = set.has(emailHash(email));
      process.stdout.write(`${present ? "yes" : "no"}: ${email}\n`);
      return present ? 0 : 2;
    }
    case "list": {
      process.stdout.write(
        `${set.size} hashes in ${file}\n${[...set].sort().join("\n")}\n`,
      );
      return 0;
    }
    default:
      process.stderr.write(`unknown command: ${cmd}\n`);
      usage();
      return 1;
  }
}

process.exit(main());
