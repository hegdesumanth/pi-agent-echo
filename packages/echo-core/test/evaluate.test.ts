import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/evaluate.ts";
import type { Permissions, State } from "../src/types.ts";

function policy(overrides: Partial<Permissions> = {}): Permissions {
  return { rules: [], protectedPaths: [], ...overrides };
}

function state(overrides: Partial<State> = {}): State {
  return { mode: "manual", ...overrides };
}

test("manual mode: no matching rule defaults to ask", () => {
  const result = evaluate("write", { path: "a.txt" }, policy(), state());
  assert.equal(result.decision, "ask");
});

test("manual mode: first matching rule wins", () => {
  const result = evaluate(
    "bash",
    { command: "ls" },
    policy({
      rules: [
        { tool: "bash", decision: "allow" },
        { tool: "bash", decision: "deny" },
      ],
    }),
    state(),
  );
  assert.equal(result.decision, "allow");
});

test("manual mode: rule pattern must match the subject", () => {
  const rules = [{ tool: "bash", pattern: "rm -rf", decision: "deny" as const }];
  const denied = evaluate("bash", { command: "rm -rf /tmp" }, policy({ rules }), state());
  assert.equal(denied.decision, "deny");

  const allowed = evaluate("bash", { command: "ls -la" }, policy({ rules }), state());
  assert.equal(allowed.decision, "ask");
});

test("protected path: write to a protected path is denied even with an allow-all rule", () => {
  const result = evaluate(
    "write",
    { path: "/home/user/.ssh/authorized_keys" },
    policy({
      rules: [{ tool: "*", decision: "allow" }],
      protectedPaths: ["/home/user/.ssh/"],
    }),
    state(),
  );
  assert.equal(result.decision, "deny");
  assert.match(result.reason ?? "", /Protected path/);
});

test("protected path: still denied under bypass mode", () => {
  const result = evaluate(
    "edit",
    { path: "/repo/.pi/echo/permissions.json" },
    policy({ protectedPaths: ["/repo/.pi/echo/permissions.json"] }),
    state({ mode: "bypass" }),
  );
  assert.equal(result.decision, "deny");
});

test("protected path: best-effort bash substring scan", () => {
  const result = evaluate(
    "bash",
    { command: "cat secret.txt > .env" },
    policy({ protectedPaths: [".env"] }),
    state(),
  );
  assert.equal(result.decision, "deny");
});

test("bypass mode: allows everything not protected", () => {
  const result = evaluate("bash", { command: "rm -rf /" }, policy(), state({ mode: "bypass" }));
  assert.equal(result.decision, "allow");
});

test("plan mode: read-only tools fall through to rule evaluation", () => {
  const result = evaluate("read", { path: "a.txt" }, policy(), state({ mode: "plan" }));
  assert.equal(result.decision, "ask");
});

test("plan mode: everything else is denied", () => {
  const result = evaluate("write", { path: "a.txt" }, policy(), state({ mode: "plan" }));
  assert.equal(result.decision, "deny");
});

test("acceptEdits mode: write/edit auto-allowed", () => {
  const write = evaluate("write", { path: "a.txt" }, policy(), state({ mode: "acceptEdits" }));
  assert.equal(write.decision, "allow");
  const edit = evaluate("edit", { path: "a.txt" }, policy(), state({ mode: "acceptEdits" }));
  assert.equal(edit.decision, "allow");
});

test("acceptEdits mode: other tools still go through rules", () => {
  const result = evaluate("bash", { command: "ls" }, policy(), state({ mode: "acceptEdits" }));
  assert.equal(result.decision, "ask");
});

test("dontAsk mode: ask resolutions become allow", () => {
  const result = evaluate("bash", { command: "ls" }, policy(), state({ mode: "dontAsk" }));
  assert.equal(result.decision, "allow");
});

test("dontAsk mode: explicit deny rules still deny", () => {
  const result = evaluate(
    "bash",
    { command: "rm -rf /" },
    policy({ rules: [{ tool: "bash", pattern: "rm -rf", decision: "deny" }] }),
    state({ mode: "dontAsk" }),
  );
  assert.equal(result.decision, "deny");
});

test("malformed rule pattern never silently matches", () => {
  const result = evaluate(
    "bash",
    { command: "ls" },
    policy({ rules: [{ tool: "bash", pattern: "(unterminated", decision: "allow" }] }),
    state(),
  );
  assert.equal(result.decision, "ask");
});
