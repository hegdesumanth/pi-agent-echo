import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import { readPermissions, readScopedPermissions, readState, writePermissions, writeState } from "../src/io.ts";

// Isolate both scopes to throwaway temp directories so these tests never touch
// the real ~/.pi/agent or a real project's .pi directory. getAgentDir() (used
// for global scope) respects the PI_CODING_AGENT_DIR env var override.
let tmpRoot: string;
let projectDir: string;
let previousAgentDirEnv: string | undefined;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echo-core-io-test-"));
  projectDir = path.join(tmpRoot, "project");
  fs.mkdirSync(projectDir, { recursive: true });

  previousAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(tmpRoot, "global-agent-dir");
});

after(() => {
  if (previousAgentDirEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDirEnv;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test("readPermissions seeds sensible defaults when no files exist yet", async () => {
  const permissions = await readPermissions(projectDir);
  assert.deepEqual(permissions.rules, []);
  assert.ok(permissions.protectedPaths.some((p) => p.includes(".env")));
  assert.ok(permissions.protectedPaths.some((p) => p.includes("node_modules")));
  assert.ok(permissions.protectedPaths.some((p) => p.endsWith("permissions.json")));
  assert.ok(permissions.protectedPaths.some((p) => p.endsWith("state.json")));
});

test("writePermissions + readPermissions round-trips project rules", async () => {
  await writePermissions(projectDir, "project", {
    rules: [{ tool: "bash", decision: "deny" }],
    protectedPaths: ["/some/custom/path"],
  });

  const permissions = await readPermissions(projectDir);
  assert.equal(permissions.rules.length, 1);
  assert.equal(permissions.rules[0]?.tool, "bash");
  assert.ok(permissions.protectedPaths.includes("/some/custom/path"));
});

test("project rules are checked before global rules (project first in merged list)", async () => {
  await writePermissions(projectDir, "global", { rules: [{ tool: "*", decision: "deny" }], protectedPaths: [] });
  await writePermissions(projectDir, "project", { rules: [{ tool: "bash", decision: "allow" }], protectedPaths: [] });

  const permissions = await readPermissions(projectDir);
  assert.equal(permissions.rules[0]?.tool, "bash");
  assert.equal(permissions.rules[0]?.decision, "allow");
  assert.equal(permissions.rules[1]?.tool, "*");
});

test("readScopedPermissions does NOT merge in the other scope (regression: /permissions allow used to duplicate global rules into project on every call)", async () => {
  const dir = path.join(tmpRoot, "scoped-regression");
  fs.mkdirSync(dir, { recursive: true });

  await writePermissions(dir, "global", { rules: [{ tool: "*", decision: "deny" }], protectedPaths: [] });
  await writePermissions(dir, "project", { rules: [{ tool: "bash", decision: "allow" }], protectedPaths: [] });

  // Simulate a read-modify-write cycle adding one project-scope rule, the way
  // /permissions allow|deny|ask must do it: read ONLY this scope, not the merged view.
  const scoped = await readScopedPermissions(dir, "project");
  assert.equal(scoped.rules.length, 1, "must not contain the global scope's rule");
  scoped.rules.unshift({ tool: "write", decision: "deny" });
  await writePermissions(dir, "project", scoped);

  // The project file on disk must still only contain project-authored rules — the global
  // rule must never have been copied in, no matter how many times this cycle repeats.
  const projectOnly = await readScopedPermissions(dir, "project");
  assert.deepEqual(
    projectOnly.rules.map((r) => r.tool),
    ["write", "bash"],
  );

  // The merged read-only view still correctly includes both scopes, for evaluate() to use.
  const merged = await readPermissions(dir);
  assert.deepEqual(
    merged.rules.map((r) => r.tool),
    ["write", "bash", "*"],
  );
});

test("readScopedPermissions returns an empty policy, not seeded defaults, when no file exists yet", async () => {
  const dir = path.join(tmpRoot, "scoped-fresh");
  fs.mkdirSync(dir, { recursive: true });
  const scoped = await readScopedPermissions(dir, "project");
  assert.deepEqual(scoped, { rules: [], protectedPaths: [] });
});

test("state defaults to manual mode when nothing is written yet", async () => {
  const freshDir = path.join(tmpRoot, "fresh-project");
  fs.mkdirSync(freshDir, { recursive: true });
  const state = await readState(freshDir);
  assert.equal(state.mode, "manual");
});

test("project state wins outright over global state", async () => {
  await writeState(projectDir, "global", { mode: "bypass" });
  await writeState(projectDir, "project", { mode: "plan" });

  const state = await readState(projectDir);
  assert.equal(state.mode, "plan");
});
