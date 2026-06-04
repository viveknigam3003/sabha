#!/usr/bin/env node

/**
 * Sabha marketplace validator. Validates `.claude-plugin/marketplace.json` and
 * `.cursor-plugin/marketplace.json`:
 *
 *   - marketplace name is kebab-case, owner.name present
 *   - plugins[] is non-empty; each entry has a valid lowercase name
 *   - each entry's `source` is EITHER a safe relative path (local plugin dir,
 *     which is then validated) OR an npm source object
 *     ({ source: "npm", package: "@scope/name", version: "<range>" })
 *   - npm package names look scoped/valid; version ranges are non-empty
 *   - dependencies[] (if present) reference other plugins in the same manifest
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const errors = [];
const warnings = [];

const pluginNamePattern = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const marketplaceNamePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const npmPackagePattern = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function addError(message) {
  errors.push(message);
}
function addWarning(message) {
  warnings.push(message);
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(p, ctx) {
  let raw;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    addError(`${ctx} contains invalid JSON (${p}): ${err.message}`);
    return null;
  }
}

function isSafeRelativePath(v) {
  if (typeof v !== "string" || v.length === 0) return false;
  if (path.isAbsolute(v)) return false;
  const normalized = path.posix.normalize(v.replace(/\\/g, "/"));
  return !normalized.startsWith("../") && normalized !== "..";
}

function validateNpmSource(label, source) {
  if (typeof source.package !== "string" || !npmPackagePattern.test(source.package)) {
    addError(`${label}.source.package "${source.package}" is not a valid npm package name.`);
  }
  if (typeof source.version !== "string" || source.version.length === 0) {
    addError(`${label}.source.version must be a non-empty version range (e.g. "^0.1.0").`);
  }
}

async function validateMarketplaceFile(relFile) {
  const marketplacePath = path.join(repoRoot, relFile);
  if (!(await pathExists(marketplacePath))) {
    addWarning(`No ${relFile} found — skipping.`);
    return;
  }
  const marketplace = await readJsonFile(marketplacePath, `Marketplace manifest (${relFile})`);
  if (!marketplace) return;

  if (typeof marketplace.name !== "string" || !marketplaceNamePattern.test(marketplace.name)) {
    addError(`${relFile}: "name" must be lowercase kebab-case.`);
  }
  if (!marketplace.owner || typeof marketplace.owner.name !== "string" || marketplace.owner.name.length === 0) {
    addError(`${relFile}: "owner.name" is required.`);
  }
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    addError(`${relFile}: "plugins" must be a non-empty array.`);
    return;
  }

  const seenNames = new Set();
  for (const entry of marketplace.plugins) {
    if (entry && typeof entry.name === "string") seenNames.add(entry.name);
  }

  for (const [index, entry] of marketplace.plugins.entries()) {
    const label = `${relFile} plugins[${index}]`;
    if (!entry || typeof entry !== "object") {
      addError(`${label} must be an object.`);
      continue;
    }
    if (typeof entry.name !== "string" || !pluginNamePattern.test(entry.name)) {
      addError(`${label}.name must be lowercase and use only alphanumerics, hyphens, and periods.`);
      continue;
    }

    const source = entry.source;
    if (typeof source === "string") {
      if (!isSafeRelativePath(source)) {
        addError(`${label}.source "${source}" is not a safe relative path.`);
      } else if (!(await pathExists(path.join(repoRoot, source)))) {
        addError(`${label}.source references a missing directory: "${source}".`);
      }
    } else if (source && typeof source === "object" && source.source === "npm") {
      validateNpmSource(label, source);
    } else {
      addError(`${label}.source must be a relative path string or an npm source object ({ source: "npm", package, version }).`);
    }

    if (entry.dependencies !== undefined) {
      if (!Array.isArray(entry.dependencies)) {
        addError(`${label}.dependencies must be an array of plugin names.`);
      } else {
        for (const dep of entry.dependencies) {
          if (!seenNames.has(dep)) {
            addError(`${label}.dependencies references "${dep}", which is not a plugin in this manifest.`);
          }
        }
      }
    }
  }
}

async function main() {
  await validateMarketplaceFile(path.join(".claude-plugin", "marketplace.json"));
  await validateMarketplaceFile(path.join(".cursor-plugin", "marketplace.json"));

  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const w of warnings) console.log(`- ${w}`);
    console.log("");
  }
  if (errors.length > 0) {
    console.error("Validation failed:");
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }
  console.log("Validation passed.");
}

await main();
