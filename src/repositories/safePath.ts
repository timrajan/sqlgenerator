import fs from 'node:fs/promises';
import path from 'node:path';
import { ContextError, NotFoundError } from '../errors.js';

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolves a manifest-relative path inside `root`, rejecting absolute paths,
 * `..` traversal, and symlinks whose real target leaves the root.
 * Returns the real (symlink-resolved) path of an existing regular file.
 */
export async function resolveWithinRoot(root: string, relativePath: string): Promise<string> {
  if (relativePath.includes('\0')) throw new ContextError(`Invalid path "${relativePath}"`);
  if (path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath) || relativePath.startsWith('\\')) {
    throw new ContextError(`Path "${relativePath}" must be relative to the context directory`);
  }
  const segments = relativePath.split(/[\\/]+/);
  if (segments.includes('..')) {
    throw new ContextError(`Path "${relativePath}" escapes the context directory`);
  }

  const lexical = path.resolve(root, relativePath);
  if (!isInside(path.resolve(root), lexical)) {
    throw new ContextError(`Path "${relativePath}" escapes the context directory`);
  }

  let realRoot: string;
  let realTarget: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    throw new ContextError(`Context directory not found: ${root}`);
  }
  try {
    realTarget = await fs.realpath(lexical);
  } catch {
    throw new NotFoundError(`File "${relativePath}" listed in the context was not found`);
  }
  if (!isInside(realRoot, realTarget)) {
    throw new ContextError(`Path "${relativePath}" resolves (via symlink) outside the context directory`);
  }
  return realTarget;
}

/** Reads a UTF-8 file inside `root` with a size cap. */
export async function readFileWithinRoot(root: string, relativePath: string, maxBytes: number): Promise<string> {
  const real = await resolveWithinRoot(root, relativePath);
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new ContextError(`"${relativePath}" is not a regular file`);
  if (stat.size > maxBytes) {
    throw new ContextError(`"${relativePath}" is ${stat.size} bytes; the limit is ${maxBytes} bytes`);
  }
  return fs.readFile(real, 'utf8');
}

/**
 * Verifies that a store directory is a real directory inside `root`
 * (not a symlink pointing elsewhere), creating it if missing.
 */
export async function ensureDirWithinRoot(root: string, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const [realRoot, realDir] = await Promise.all([fs.realpath(root), fs.realpath(dir)]);
  if (!isInside(realRoot, realDir)) {
    throw new ContextError(`Directory ${dir} resolves outside ${root}`);
  }
  return realDir;
}
