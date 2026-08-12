/**
 * pi-echo-plan-mode
 *
 * Read-only exploration mode for safe code analysis, adapted from Pi's own
 * official plan-mode example (examples/extensions/plan-mode/). The only real
 * change from the official example: the on/off mode flag is stored in
 * pi-echo-core's shared state.json instead of a private closure boolean, so
 * `/plan` flips the same mode pi-echo-permissions enforces. Neither package
 * imports the other — the shared file is the entire integration contract.
 *
 * Design note: `pi.setActiveTools()` is the primary enforcement here (the
 * model never even sees edit/write as callable while plan mode is on — the
 * cheapest and least confusing mechanism). pi-echo-permissions' plan-mode
 * branch in evaluate() is a deliberate backup for cases this tool-swap can't
 * cover (an in-flight call, an unknown custom/MCP tool, a state-sync bug) —
 * not redundant, and not this package's job to duplicate beyond the bash
 * allowlist below, which is plan-mode-specific and out of scope for the
 * generic permission rule shape.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { readState, writeState } from "pi-echo-core";
import type { Mode } from "pi-echo-core";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.ts";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "exit_plan_mode"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

interface PlanModeEntryState {
	todos?: TodoItem[];
	executing?: boolean;
	toolsBeforePlanMode?: string[];
	/** The mode active immediately before entering plan mode, restored on exit instead of
	 * hardcoding "manual" — found as a real bug: a project whose normal working mode is
	 * "acceptEdits" or "dontAsk" was silently demoted to "manual" every time plan mode was
	 * toggled off, regardless of what the user had actually configured. */
	previousMode?: Mode;
}

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let toolsBeforePlanMode: string[] | undefined;
	let previousMode: Mode | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	async function inPlanMode(cwd: string): Promise<boolean> {
		const state = await readState(cwd);
		return state.mode === "plan";
	}

	function updateStatus(ctx: ExtensionContext, planModeEnabled: boolean): void {
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `\u{1F4CB} ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
					);
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function uniqueToolNames(toolNames: string[]): string[] {
		return [...new Set(toolNames)];
	}

	function getPlanModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
			...PLAN_MODE_TOOLS,
		]);
	}

	function getNormalModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...NORMAL_MODE_TOOLS,
			...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
		]);
	}

	function enablePlanModeTools(): void {
		if (toolsBeforePlanMode === undefined) {
			toolsBeforePlanMode = pi.getActiveTools();
		}
		pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
	}

	function restoreNormalModeTools(): void {
		pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
		toolsBeforePlanMode = undefined;
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			todos: todoItems,
			executing: executionMode,
			toolsBeforePlanMode,
			previousMode,
		} satisfies PlanModeEntryState);
	}

	async function setPlanMode(enabled: boolean, ctx: ExtensionContext): Promise<void> {
		let targetMode: Mode;
		if (enabled) {
			if (previousMode === undefined) {
				previousMode = (await readState(ctx.cwd)).mode;
			}
			targetMode = "plan";
		} else {
			targetMode = previousMode ?? "manual";
			previousMode = undefined;
		}

		await writeState(ctx.cwd, "project", {
			mode: targetMode,
			lastModeChangeEntryId: ctx.sessionManager.getLeafId() ?? undefined,
		});
		executionMode = false;
		todoItems = [];

		if (enabled) {
			enablePlanModeTools();
			ctx.ui.notify("Plan mode enabled. Built-in write tools disabled.");
		} else {
			restoreNormalModeTools();
			ctx.ui.notify(`Plan mode disabled. Restored to "${targetMode}" mode.`);
		}
		updateStatus(ctx, enabled);
		persistState();
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => {
			const enabled = await inPlanMode(ctx.cwd);
			await setPlanMode(!enabled, ctx);
		},
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => {
			const enabled = await inPlanMode(ctx.cwd);
			await setPlanMode(!enabled, ctx);
		},
	});

	// Model-callable approval gate — only reachable while plan mode is active
	// (folded into PLAN_MODE_TOOLS above), layered on top of the agent_end
	// heuristic fallback below for models that describe a plan without calling it.
	pi.registerTool({
		name: "exit_plan_mode",
		label: "Exit Plan Mode",
		description:
			"Call this when you have finished planning and are ready to present the plan for approval before executing it.",
		parameters: Type.Object({
			plan: Type.String({ description: "The full plan, as markdown" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Approval unavailable (headless mode) — plan not executed." }],
					details: {},
				};
			}

			const choice = await ctx.ui.select(`Plan ready:\n\n${params.plan}\n\nApprove?`, [
				"Approve — execute",
				"Keep planning",
				"Reject",
			]);

			if (choice === "Approve — execute") {
				await setPlanMode(false, ctx);
				return {
					content: [{ type: "text", text: "Approved. Plan mode disabled, full tool access restored." }],
					details: {},
				};
			}
			return {
				content: [
					{
						type: "text",
						text: choice === "Reject" ? "Rejected — stay in plan mode." : "Continue planning.",
					},
				],
				details: {},
			};
		},
	});

	// Block destructive bash commands in plan mode
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		if (!(await inPlanMode(ctx.cwd))) return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	// Filter out stale plan-mode context when not in plan mode
	pi.on("context", async (event, ctx) => {
		if (await inPlanMode(ctx.cwd)) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async (_event, ctx) => {
		if (await inPlanMode(ctx.cwd)) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- Built-in edit and write tools are disabled
- Other currently active tools remain available
- Bash is restricted to an allowlist of read-only commands

Create a detailed numbered plan under a "Plan:" header, then call the
exit_plan_mode tool with the full plan text to request approval:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
					display: false,
				},
			};
		}
	});

	// Track progress after each turn
	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx, false);
		}
		persistState();
	});

	// Handle plan completion and the agent_end fallback UI
	pi.on("agent_end", async (event, ctx) => {
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				updateStatus(ctx, false);
				persistState(); // Save cleared state so resume doesn't restore old execution mode
			}
			return;
		}

		const planModeEnabled = await inPlanMode(ctx.cwd);
		if (!planModeEnabled || !ctx.hasUI) return;

		// Fallback: the model described a plan in prose without calling exit_plan_mode.
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		if (todoItems.length === 0) return;
		persistState();

		const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
		const planTodoListMessage = {
			customType: "plan-todo-list",
			content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
			display: true,
		};

		const choice = await ctx.ui.select("Plan mode - what next?", [
			"Execute the plan (track progress)",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute")) {
			const firstTodoItem = todoItems[0];
			if (!firstTodoItem) return;

			await setPlanMode(false, ctx);
			executionMode = true;
			updateStatus(ctx, false);
			persistState();

			const remainingList = todoItems.map((t) => `${t.step}. ${t.text}`).join("\n");
			const execMessage = `Execute the plan.

Remaining steps:
${remainingList}

Start with: ${firstTodoItem.text}
After completing a step, include a [DONE:n] tag in your response.`;
			pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
			pi.sendMessage(
				{ customType: "plan-mode-execute", content: execMessage, display: true },
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();

		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: PlanModeEntryState } | undefined;

		if (planModeEntry?.data) {
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
			previousMode = planModeEntry.data.previousMode ?? previousMode;
		}

		// Restore previousMode BEFORE handling --plan, so a resumed session that was already in
		// plan mode with a captured previousMode doesn't get it clobbered by the flag re-forcing
		// plan mode on this run.
		if (pi.getFlag("plan") === true) {
			if (previousMode === undefined) {
				previousMode = (await readState(ctx.cwd)).mode;
			}
			await writeState(ctx.cwd, "project", { mode: "plan" });
		}

		// On resume: re-scan messages to rebuild completion state.
		// Only scan messages AFTER the last "plan-mode-execute" to avoid picking up
		// [DONE:n] from a previous plan.
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry && entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		const planModeEnabled = await inPlanMode(ctx.cwd);
		if (planModeEnabled) {
			enablePlanModeTools();
		}
		updateStatus(ctx, planModeEnabled);
	});
}
