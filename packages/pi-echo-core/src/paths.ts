import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

/** Global scope: ~/.pi/agent/echo/ */
export function globalEchoDir(): string {
  return path.join(getAgentDir(), "echo");
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Nearest-ancestor search for an existing `.pi/echo` directory, starting at `cwd`
 * and walking up. Mirrors the pattern used by Pi's own subagent example
 * (`findNearestProjectAgentsDir`). Falls back to `<cwd>/.pi/echo` when none exists
 * yet, so the first write creates it at the project root the user is actually in,
 * not some unrelated ancestor.
 */
export function findProjectEchoDir(cwd: string): string {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, CONFIG_DIR_NAME, "echo");
    if (isDirectory(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return path.join(cwd, CONFIG_DIR_NAME, "echo");
}

export function permissionsFilePath(dir: string): string {
  return path.join(dir, "permissions.json");
}

export function stateFilePath(dir: string): string {
  return path.join(dir, "state.json");
}
