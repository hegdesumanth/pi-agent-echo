/**
 * Shared types for echo's permission/mode system.
 *
 * `Mode` is a five-way enum (manual/acceptEdits/plan/dontAsk/bypass) rather
 * than a bespoke scheme, so echo-plan-mode and echo-permissions can share
 * one state.json field.
 */

export type Mode = "manual" | "acceptEdits" | "plan" | "dontAsk" | "bypass";

export type Decision = "allow" | "ask" | "deny";

export interface PermissionRule {
  /** Exact tool name, or "*" to match any tool. */
  tool: string;
  /** Optional regex source tested against a tool-specific subject string (see evaluate()). */
  pattern?: string;
  decision: Decision;
}

export interface Permissions {
  /** Ordered rule list — first match wins. */
  rules: PermissionRule[];
  /**
   * Paths that are always denied for write/edit (and best-effort matched against bash
   * commands) regardless of mode or rules — including bypass mode. Must always include
   * the permissions/state files themselves so a prompt-injected instruction can't talk
   * the model into loosening its own leash via the write tool.
   */
  protectedPaths: string[];
}

export interface State {
  mode: Mode;
  lastModeChangeEntryId?: string;
}

export interface EvaluateResult {
  decision: Decision;
  reason?: string;
}

export type ConfigScope = "global" | "project";
