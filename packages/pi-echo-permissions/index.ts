/**
 * pi-echo-permissions
 *
 * A cooperative permission gate for every tool call, backed by pi-echo-core's
 * shared permissions.json/state.json files. This is NOT a sandbox — see
 * SECURITY.md and the design note below.
 *
 * Design note: this extension's only enforcement surface is Pi's own
 * `tool_call` event. It deliberately does not attempt OS-level isolation —
 * a bash command it allows can still do anything a shell can do, and any
 * future extension that adds a filesystem- or network-touching tool without
 * going through the standard `tool_call` path is invisible to it by
 * construction, not by oversight.
 */

import { evaluate, readPermissions, readState } from "pi-echo-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerPermissionsCommand } from "./commands.ts";

function describeCall(toolName: string, input: Record<string, unknown>): string {
  if ((toolName === "write" || toolName === "edit") && typeof input.path === "string") {
    return `${toolName} ${input.path}`;
  }
  if (toolName === "bash" && typeof input.command === "string") {
    return `bash: ${input.command}`;
  }
  return `${toolName} ${JSON.stringify(input)}`;
}

export default function (pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx: ExtensionContext) => {
    const input = event.input as Record<string, unknown>;
    const [policy, state] = await Promise.all([readPermissions(ctx.cwd), readState(ctx.cwd)]);
    const { decision, reason } = evaluate(event.toolName, input, policy, state);

    if (decision === "deny") {
      return { block: true, reason: reason ?? `Denied by pi-echo-permissions (mode: ${state.mode})` };
    }

    if (decision === "ask") {
      if (!ctx.hasUI) {
        // Headless/no-UI mode: no one to confirm with, so the safe default is deny —
        // matching Pi's own official permission-gate.ts example.
        return { block: true, reason: "Ask-decision requires confirmation; no UI available (headless mode)" };
      }

      const subject = describeCall(event.toolName, input);
      const choice = await ctx.ui.select(`Allow this action?\n\n  ${subject}`, ["Allow", "Deny"]);
      if (choice !== "Allow") {
        return { block: true, reason: "Denied by user" };
      }
    }

    return undefined;
  });

  registerPermissionsCommand(pi);
}
