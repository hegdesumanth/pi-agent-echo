/**
 * pi-echo-todos
 *
 * A general-purpose, model-callable todo list — independent of
 * pi-echo-plan-mode's own todo tracking (which only exists during plan-mode
 * execution). A single tool the model can call at any time, with any task,
 * to transparently track its own multi-step progress, rendered as a
 * persistent widget above the editor.
 *
 * Design note: uses `pi.registerTool()` for the whole-list-replace tool and
 * `ctx.ui.setWidget()` for the persistent rendering — both plain Pi
 * primitives, no new mechanism invented. State is session-scoped, persisted
 * via `pi.appendEntry()` and restored on `session_start`, the same pattern
 * `pi-echo-plan-mode` uses for its own todo list. Deliberately does not enforce
 * "exactly one in_progress item at a time" as a hard rule — it's surfaced as
 * a warning in the tool result, not a rejected call, since a model that
 * briefly has two in-flight items is not a case worth blocking over.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

type TodoStatus = "pending" | "in_progress" | "completed";

interface TodoItem {
	content: string;
	status: TodoStatus;
	activeForm?: string;
}

const TodoItemSchema = Type.Object({
	content: Type.String({ description: "The task description, in imperative form (e.g. 'Fix the login bug')" }),
	status: StringEnum(["pending", "in_progress", "completed"] as const),
	activeForm: Type.Optional(
		Type.String({ description: "Present-continuous form shown while in_progress (e.g. 'Fixing the login bug')" }),
	),
});

const TodoWriteParams = Type.Object({
	todos: Type.Array(TodoItemSchema, {
		description: "The full todo list, replacing whatever was there before. Pass an empty array to clear it.",
	}),
});

function statusIcon(status: TodoStatus): string {
	if (status === "completed") return "☑";
	if (status === "in_progress") return "◐";
	return "☐";
}

export default function (pi: ExtensionAPI): void {
	let todos: TodoItem[] = [];

	function persist(): void {
		pi.appendEntry("echo-todos", todos);
	}

	function render(ctx: ExtensionContext): void {
		if (todos.length === 0) {
			ctx.ui.setStatus("echo-todos", undefined);
			ctx.ui.setWidget("echo-todos", undefined);
			return;
		}

		const completed = todos.filter((t) => t.status === "completed").length;
		ctx.ui.setStatus("echo-todos", ctx.ui.theme.fg("accent", `\u{1F4CB} ${completed}/${todos.length}`));

		const lines = todos.map((t) => {
			const label = t.status === "in_progress" ? t.activeForm ?? t.content : t.content;
			if (t.status === "completed") {
				return ctx.ui.theme.fg("success", `${statusIcon(t.status)} `) + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(label));
			}
			if (t.status === "in_progress") {
				return ctx.ui.theme.fg("warning", `${statusIcon(t.status)} ${label}`);
			}
			return `${ctx.ui.theme.fg("muted", `${statusIcon(t.status)} `)}${label}`;
		});
		ctx.ui.setWidget("echo-todos", lines);
	}

	pi.registerTool({
		name: "todo_write",
		label: "Todo List",
		description:
			"Replace the current todo list with a new one, to transparently track progress on a multi-step task. Call this whenever you start, complete, or re-plan steps. Pass the full list every time (not a diff) — pass an empty array to clear it once the task is done.",
		parameters: TodoWriteParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			todos = params.todos;
			persist();
			render(ctx);

			const inProgressCount = todos.filter((t) => t.status === "in_progress").length;
			const warning = inProgressCount > 1 ? `\nNote: ${inProgressCount} items are in_progress at once.` : "";

			if (todos.length === 0) {
				return { content: [{ type: "text", text: "Todo list cleared." }], details: undefined };
			}
			const summary = todos.map((t) => `${statusIcon(t.status)} ${t.content}`).join("\n");
			return { content: [{ type: "text", text: `Todo list updated:\n${summary}${warning}` }], details: undefined };
		},
	});

	pi.registerCommand("todo", {
		description: "Show the current todo list",
		handler: async (_args, ctx) => {
			if (todos.length === 0) {
				ctx.ui.notify("No todos.", "info");
				return;
			}
			const list = todos.map((t) => `${statusIcon(t.status)} ${t.content}`).join("\n");
			ctx.ui.notify(list, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		const latest = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "echo-todos")
			.pop() as { data?: TodoItem[] } | undefined;

		if (latest?.data) {
			todos = latest.data;
		}
		render(ctx);
	});
}
