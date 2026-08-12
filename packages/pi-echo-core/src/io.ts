import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { findProjectEchoDir, globalEchoDir, permissionsFilePath, stateFilePath } from "./paths.ts";
import type { ConfigScope, Permissions, State } from "./types.ts";

const DEFAULT_STATE: State = { mode: "manual" };

function defaultProtectedPaths(dir: string): string[] {
  return [
    permissionsFilePath(dir),
    stateFilePath(dir),
    ".env",
    ".git/",
    "node_modules/",
    path.join(os.homedir(), ".ssh/"),
  ];
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    throw err;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  });
}

function scopeDir(cwd: string, scope: ConfigScope): string {
  return scope === "global" ? globalEchoDir() : findProjectEchoDir(cwd);
}

async function readRawPermissionsFile(dir: string): Promise<Permissions | undefined> {
  return readJsonFile<Permissions>(permissionsFilePath(dir));
}

/**
 * Merged permissions: project rules first (checked before global rules, so a
 * project-local override wins on first-match-wins evaluation), global rules
 * appended after. protectedPaths is the union of both scopes, plus this
 * scope's own permissions.json/state.json paths, seeded on first read so a
 * fresh project never starts with an empty protected list.
 *
 * This is a READ-ONLY view for `evaluate()` — do not use it as the base for
 * a scoped write. Writing this merged result back to a single scope would
 * duplicate the other scope's rules into it every time (a real bug found
 * this way in `pi-echo-permissions`' `/permissions allow|deny|ask` command; use
 * `readScopedPermissions()` for any read-modify-write cycle instead).
 */
export async function readPermissions(cwd: string): Promise<Permissions> {
  const projectDir = findProjectEchoDir(cwd);
  const globalDir = globalEchoDir();

  const [project, global] = await Promise.all([
    readRawPermissionsFile(projectDir),
    readRawPermissionsFile(globalDir),
  ]);

  const seededDefaults = new Set([...defaultProtectedPaths(projectDir), ...defaultProtectedPaths(globalDir)]);

  const rules = [...(project?.rules ?? []), ...(global?.rules ?? [])];
  const protectedPaths = new Set<string>(seededDefaults);
  for (const p of project?.protectedPaths ?? []) protectedPaths.add(p);
  for (const p of global?.protectedPaths ?? []) protectedPaths.add(p);

  return { rules, protectedPaths: [...protectedPaths] };
}

/**
 * Single-scope permissions, unmerged — the correct base for a
 * read-modify-write cycle (e.g. adding one rule) that should only affect
 * that scope's own file. Returns an empty policy (not defaults) when no
 * file exists yet at this scope, since defaults are a read-time concern of
 * `readPermissions()`, not something that should get written to disk by a
 * single-rule edit.
 */
export async function readScopedPermissions(cwd: string, scope: ConfigScope): Promise<Permissions> {
  const dir = scopeDir(cwd, scope);
  const raw = await readRawPermissionsFile(dir);
  return raw ?? { rules: [], protectedPaths: [] };
}

export async function writePermissions(cwd: string, scope: ConfigScope, permissions: Permissions): Promise<void> {
  const dir = scopeDir(cwd, scope);
  await writeJsonFile(permissionsFilePath(dir), permissions);
}

/** Project state wins outright over global state — mode is a single scalar, not merged. */
export async function readState(cwd: string): Promise<State> {
  const projectDir = findProjectEchoDir(cwd);
  const project = await readJsonFile<State>(stateFilePath(projectDir));
  if (project) return project;

  const global = await readJsonFile<State>(stateFilePath(globalEchoDir()));
  return global ?? DEFAULT_STATE;
}

export async function writeState(cwd: string, scope: ConfigScope, state: State): Promise<void> {
  const dir = scopeDir(cwd, scope);
  await writeJsonFile(stateFilePath(dir), state);
}
