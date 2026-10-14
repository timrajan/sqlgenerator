import fs from 'node:fs/promises';
import path from 'node:path';
import { UserFacingError } from '../errors.js';

const STALE_MS = 30_000;
const TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cross-process mutex using an exclusive `mkdir`, which is atomic on every
 * mainstream filesystem (including exFAT/FAT, which lack hard links and
 * symlinks). Used to serialise example-store mutations between the MCP
 * server and the review CLI. Locks older than 30 s are treated as stale
 * (e.g. a crashed process) and broken.
 */
export async function withDirLock<T>(storeDir: string, fn: () => Promise<T>): Promise<T> {
  const lockDir = path.join(storeDir, '.lock');
  const started = Date.now();
  let delay = 20;

  for (;;) {
    try {
      await fs.mkdir(lockDir);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        const stat = await fs.stat(lockDir);
        if (Date.now() - stat.mtimeMs > STALE_MS) {
          await fs.rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue; // lock vanished between mkdir and stat; retry immediately
      }
      if (Date.now() - started > TIMEOUT_MS) {
        throw new UserFacingError(
          `Example store is locked by another process (${lockDir}). If no other review is running, delete that directory.`,
        );
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 250);
    }
  }

  try {
    return await fn();
  } finally {
    await fs.rm(lockDir, { recursive: true, force: true });
  }
}
