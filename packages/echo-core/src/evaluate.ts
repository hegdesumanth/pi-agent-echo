import type { Decision, EvaluateResult, Permissions, PermissionRule, State } from "./types.ts";

/** Tools allowed while in "plan" mode — read-only exploration only. */
const PLAN_MODE_ALLOWLIST = new Set(["read", "grep", "find", "ls"]);

function subjectFor(toolName: string, input: Record<string, unknown>): string {
  if ((toolName === "write" || toolName === "edit") && typeof input.path === "string") return input.path;
  if (toolName === "bash" && typeof input.command === "string") return input.command;
  return JSON.stringify(input);
}

function matchesRule(rule: PermissionRule, toolName: string, subject: string): boolean {
  if (rule.tool !== "*" && rule.tool !== toolName) return false;
  if (!rule.pattern) return true;
  try {
    return new RegExp(rule.pattern).test(subject);
  } catch {
    // Malformed pattern — never let a broken regex silently match everything.
    return false;
  }
}

function evaluateRules(toolName: string, input: Record<string, unknown>, rules: PermissionRule[]): EvaluateResult {
  const subject = subjectFor(toolName, input);
  const match = rules.find((rule) => matchesRule(rule, toolName, subject));
  if (match) return { decision: match.decision, reason: `Matched rule: ${match.tool}${match.pattern ? ` /${match.pattern}/` : ""}` };
  return { decision: "ask", reason: "No matching rule (default: ask)" };
}

/**
 * Best-effort protected-path check, run before mode/rules so it can never be
 * bypassed — including by "bypass" mode itself. write/edit are checked against
 * the tool's own `path` input field (confirmed field name against the installed
 * package). bash has no structured path field, so it's a substring scan of the
 * command string — this catches straightforward redirection/copy attempts but
 * is explicitly NOT a complete defense against obfuscated command injection
 * (see echo-permissions' design note / SECURITY.md).
 */
function findProtectedPathViolation(
  toolName: string,
  input: Record<string, unknown>,
  protectedPaths: string[],
): string | undefined {
  if ((toolName === "write" || toolName === "edit") && typeof input.path === "string") {
    return protectedPaths.find((p) => input.path === p || (input.path as string).includes(p));
  }
  if (toolName === "bash" && typeof input.command === "string") {
    return protectedPaths.find((p) => (input.command as string).includes(p));
  }
  return undefined;
}

/**
 * Pure decision function — no I/O, no UI. Priority order:
 *   1. protected-path match -> hard deny, regardless of mode (including bypass)
 *   2. bypass mode          -> allow
 *   3. plan mode            -> deny anything outside the read-only allowlist
 *   4. acceptEdits mode     -> auto-allow write/edit
 *   5. dontAsk mode         -> "ask" rule resolutions become "allow"
 *   6. manual (default)     -> first-matching-rule wins, default "ask"
 */
export function evaluate(
  toolName: string,
  input: Record<string, unknown>,
  policy: Permissions,
  state: State,
): EvaluateResult {
  const violated = findProtectedPathViolation(toolName, input, policy.protectedPaths);
  if (violated) {
    return { decision: "deny", reason: `Protected path: ${violated}` };
  }

  if (state.mode === "bypass") {
    return { decision: "allow", reason: "bypass mode" };
  }

  if (state.mode === "plan") {
    if (PLAN_MODE_ALLOWLIST.has(toolName)) {
      return evaluateRules(toolName, input, policy.rules);
    }
    return { decision: "deny", reason: "plan mode active (read-only)" };
  }

  if (state.mode === "acceptEdits" && (toolName === "write" || toolName === "edit")) {
    return { decision: "allow", reason: "acceptEdits mode" };
  }

  const result = evaluateRules(toolName, input, policy.rules);

  if (state.mode === "dontAsk" && result.decision === "ask") {
    return { decision: "allow", reason: "dontAsk mode (ask resolves to allow)" };
  }

  return result;
}

export type { Decision, EvaluateResult, Permissions, PermissionRule, State };
