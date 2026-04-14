import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export function generateId(): string {
  return randomBytes(4).toString('hex');
}

export function getGitRoot(cwd: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export function getGitBranch(cwd: string): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export { getDefaultName } from './names.js';

export function resolveEntryPoint(baseDir: string, ...segments: string[]): string {
  const tsPath = resolve(baseDir, ...segments.slice(0, -1), segments[segments.length - 1].replace(/\.\w+$/, '.ts'));
  if (existsSync(tsPath)) return tsPath;
  const jsPath = resolve(baseDir, ...segments.slice(0, -1), segments[segments.length - 1].replace(/\.\w+$/, '.js'));
  if (existsSync(jsPath)) return jsPath;
  // Fallback: return .ts path (will fail at runtime with a clear error)
  return tsPath;
}

export function getTty(): string | null {
  try {
    return execSync('tty', {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}
