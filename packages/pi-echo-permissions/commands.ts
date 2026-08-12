import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readPermissions, readScopedPermissions, readState, writePermissions, writeState } from "pi-echo-core";
import type { Decision, Mode, PermissionRule } from "pi-echo-core";

const MODES: Mode[] = ["manual", "acceptEdits", "plan", "dontAsk", "bypass"];
const DECISIONS: Decision[] = ["allow", "deny", "ask"];

function parseArgs(args: string): string[] {
  return args.trim().length > 0 ? args.trim().split(/\s+/) : [];
}

function scopeFromFlags(tokens: string[]): { scope: "global" | "project"; rest: string[] } {
  const rest = tokens.filter((t) => t !== "-g");
  const scope = tokens.includes("-g") ? "global" : "project";
  return { scope, rest };
}

async function handleStatus(ctx: ExtensionCommandContext): Promise<void> {
  const [policy, state] = await Promise.all([readPermissions(ctx.cwd), readState(ctx.cwd)]);
  ctx.ui.notify(
    [
      `Mode: ${state.mode}`,
      `Rules: ${policy.rules.length}`,
      ...policy.rules.map((r, i) => `  ${i + 1}. ${r.tool}${r.pattern ? ` /${r.pattern}/` : ""} -> ${r.decision}`),
      `Protected paths: ${policy.protectedPaths.length}`,
    ].join("\n"),
    "info",
  );
}

async function handleMode(tokens: string[], ctx: ExtensionCommandContext): Promise<void> {
  const { scope, rest } = scopeFromFlags(tokens);
  const mode = rest[0] as Mode | undefined;
  if (!mode || !MODES.includes(mode)) {
    ctx.ui.notify(`Usage: /permissions mode <${MODES.join("|")}> [-g]`, "error");
    return;
  }
  await writeState(ctx.cwd, scope, { mode, lastModeChangeEntryId: ctx.sessionManager.getLeafId() ?? undefined });
  ctx.ui.notify(`Mode set to "${mode}" (${scope} scope)`, "info");
}

async function handleRule(decision: Decision, tokens: string[], ctx: ExtensionCommandContext): Promise<void> {
  const { scope, rest } = scopeFromFlags(tokens);
  const tool = rest[0];
  const pattern = rest[1];
  if (!tool) {
    ctx.ui.notify(`Usage: /permissions ${decision} <tool> [pattern] [-g]`, "error");
    return;
  }

  const rule: PermissionRule = { tool, decision, ...(pattern ? { pattern } : {}) };
  // Read-modify-write against this scope ONLY — readPermissions() returns a merged
  // project+global view, and writing that back to a single scope would duplicate the
  // other scope's rules into it on every /permissions call. Found and fixed as a real bug.
  const policy = await readScopedPermissions(ctx.cwd, scope);
  policy.rules.unshift(rule);
  await writePermissions(ctx.cwd, scope, policy);

  if (decision === "allow" && (tool === "*" || tool === "write" || tool === "edit")) {
    ctx.ui.notify(
      "Note: this rule cannot override protectedPaths — those are always denied regardless of any rule, including this one.",
      "warning",
    );
  }
  ctx.ui.notify(`Rule added (${scope} scope): ${tool}${pattern ? ` /${pattern}/` : ""} -> ${decision}`, "info");
}

export function registerPermissionsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("permissions", {
    description: "Manage echo's permission policy (status, mode, allow, deny, ask)",
    handler: async (args, ctx) => {
      const tokens = parseArgs(args);
      const [subcommand, ...rest] = tokens;

      if (!subcommand || subcommand === "status") {
        await handleStatus(ctx);
        return;
      }

      if (subcommand === "mode") {
        await handleMode(rest, ctx);
        return;
      }

      if (DECISIONS.includes(subcommand as Decision)) {
        await handleRule(subcommand as Decision, rest, ctx);
        return;
      }

      ctx.ui.notify(
        `Unknown subcommand "${subcommand}". Usage: /permissions status | mode <mode> | allow|deny|ask <tool> [pattern]`,
        "error",
      );
    },
  });
}
