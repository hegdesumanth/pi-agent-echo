/**
 * pi-echo-tasks
 *
 * Background job tool with pollable status — Pi's built-in `bash` tool always
 * runs to completion before returning, with no way to launch a long-running
 * process and check on it later. This package fills that gap with three
 * tools (`run_task`, `task_status`, `kill_task`) and a `/tasks` command.
 *
 * Design note: this deliberately does NOT reuse Pi's own bash-tool operations
 * (`createLocalBashOperations`/`execCommand`), since those are built to await
 * completion — exactly the behavior a background task needs to avoid. It
 * spawns directly via `node:child_process` instead. Tasks are tracked
 * in-memory only, for the lifetime of the current `pi` process — they are
 * NOT persisted across a session reload/resume (a spawned child process
 * can't be "resumed" from a JSON entry, since it's a live OS process handle),
 * and are not killed automatically when `pi` exits (inherited default Node
 * child-process behavior). Output is capped via a bounded rolling buffer
 * (reusing `truncateTail` from `@earendil-works/pi-coding-agent`) so a
 * chatty long-running process can't grow memory unboundedly.
 */

import { type ChildProcess, spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateTail } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const OUTPUT_CAP_BYTES = 16 * 1024;
const OUTPUT_REBUFFER_THRESHOLD_BYTES = OUTPUT_CAP_BYTES * 2;

type TaskStatus = "running" | "exited" | "killed";

interface TaskRecord {
	id: string;
	command: string;
	cwd: string;
	startedAt: number;
	endedAt?: number;
	status: TaskStatus;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	child: ChildProcess;
}

function appendCapped(current: string, chunk: string): string {
	const combined = current + chunk;
	if (Buffer.byteLength(combined, "utf8") <= OUTPUT_REBUFFER_THRESHOLD_BYTES) return combined;
	return truncateTail(combined, { maxBytes: OUTPUT_CAP_BYTES }).content;
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${seconds % 60}s`;
}

const RunTaskParams = Type.Object({
	command: Type.String({ description: "Shell command to run in the background" }),
	cwd: Type.Optional(Type.String({ description: "Working directory (default: current session cwd)" })),
});

const TaskIdParams = Type.Object({
	taskId: Type.String({ description: "Task id returned by run_task" }),
});

export default function (pi: ExtensionAPI): void {
	const tasks = new Map<string, TaskRecord>();
	let nextId = 1;

	function summarize(task: TaskRecord): string {
		const duration = formatDuration((task.endedAt ?? Date.now()) - task.startedAt);
		const statusText =
			task.status === "running" ? `running (${duration})` : `${task.status} after ${duration}, exit code ${task.exitCode}`;
		return `[${task.id}] ${task.command}\n  status: ${statusText}`;
	}

	pi.registerTool({
		name: "run_task",
		label: "Run Background Task",
		description:
			"Start a shell command in the background and return immediately with a task id. Use task_status to poll it and kill_task to stop it. Prefer the regular bash tool for anything that finishes quickly.",
		parameters: RunTaskParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const id = `task-${nextId++}`;
			const child = spawn(params.command, {
				shell: true,
				cwd: params.cwd ?? ctx.cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});

			const record: TaskRecord = {
				id,
				command: params.command,
				cwd: params.cwd ?? ctx.cwd,
				startedAt: Date.now(),
				status: "running",
				exitCode: null,
				stdout: "",
				stderr: "",
				child,
			};
			tasks.set(id, record);

			child.stdout?.on("data", (data) => {
				record.stdout = appendCapped(record.stdout, data.toString());
			});
			child.stderr?.on("data", (data) => {
				record.stderr = appendCapped(record.stderr, data.toString());
			});
			child.on("close", (code) => {
				if (record.status === "running") record.status = "exited";
				record.exitCode = code;
				record.endedAt = Date.now();
			});
			child.on("error", (err) => {
				record.status = "exited";
				record.exitCode = null;
				record.stderr = appendCapped(record.stderr, `\n[spawn error: ${err.message}]`);
				record.endedAt = Date.now();
			});

			return {
				content: [{ type: "text", text: `Started ${id}: ${params.command}` }],
				details: { taskId: id },
			};
		},
	});

	pi.registerTool({
		name: "task_status",
		label: "Task Status",
		description: "Check the status and recent output of a background task started with run_task.",
		parameters: TaskIdParams,
		async execute(_toolCallId, params) {
			const task = tasks.get(params.taskId);
			if (!task) {
				return { content: [{ type: "text", text: `Unknown task id: ${params.taskId}` }], details: undefined, isError: true };
			}

			const text = [
				summarize(task),
				"--- stdout (tail) ---",
				task.stdout || "(empty)",
				"--- stderr (tail) ---",
				task.stderr || "(empty)",
			].join("\n");
			return { content: [{ type: "text", text }], details: undefined };
		},
	});

	pi.registerTool({
		name: "kill_task",
		label: "Kill Task",
		description: "Stop a running background task started with run_task.",
		parameters: TaskIdParams,
		async execute(_toolCallId, params) {
			const task = tasks.get(params.taskId);
			if (!task) {
				return { content: [{ type: "text", text: `Unknown task id: ${params.taskId}` }], details: undefined, isError: true };
			}
			if (task.status !== "running") {
				return { content: [{ type: "text", text: `${params.taskId} is already ${task.status}.` }], details: undefined };
			}

			task.child.kill("SIGTERM");
			setTimeout(() => {
				if (task.status === "running") task.child.kill("SIGKILL");
			}, 5000);
			task.status = "killed";
			task.endedAt = Date.now();

			return { content: [{ type: "text", text: `Killed ${params.taskId}.` }], details: undefined };
		},
	});

	pi.registerCommand("tasks", {
		description: "List background tasks started with run_task",
		handler: async (_args, ctx) => {
			if (tasks.size === 0) {
				ctx.ui.notify("No background tasks in this session.", "info");
				return;
			}
			const list = [...tasks.values()].map((t) => summarize(t)).join("\n");
			ctx.ui.notify(list, "info");
		},
	});
}
