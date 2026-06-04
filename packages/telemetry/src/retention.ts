import { readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { metaDir, sessionsDir } from "./paths.js";

export interface RetentionResult {
  scanned: number;
  pruned: number;
  errors: number;
}

/**
 * Deletes session JSONL + meta files older than `retentionDays`. Driven from
 * the sessionEnd hook so retention runs piggyback on activity (an idle laptop
 * never accrues runaway files because no events are being written either).
 *
 * Never throws — surfaces partial failures via the `errors` counter so the
 * doctor can flag a misbehaving filesystem.
 */
export async function pruneOldSessions(
  retentionDays: number,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<RetentionResult> {
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  let scanned = 0;
  let pruned = 0;
  let errors = 0;

  for (const dir of [sessionsDir(env), metaDir(env)]) {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      errors++;
      continue;
    }
    for (const name of entries) {
      const file = resolve(dir, name);
      scanned++;
      try {
        const s = await stat(file);
        if (s.mtimeMs < cutoffMs) {
          await rm(file, { recursive: true, force: true });
          pruned++;
        }
      } catch {
        errors++;
      }
    }
  }

  return { scanned, pruned, errors };
}
