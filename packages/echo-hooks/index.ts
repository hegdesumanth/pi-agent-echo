/**
 * echo-hooks
 *
 * A no-code, JSON-configured hooks system: declare a shell command per
 * lifecycle event in a config file, no TypeScript required — distinct from
 * Pi's own hooks concept (which means "write an extension"). Six lifecycle
 * events are mapped here; the rest have no Pi primitive to map onto and are
 * honestly listed as unsupported, not silently dropped — see the coverage
 * table in this package's README.
 *
 * Design note: only `PreToolUse` supports blocking (exit code 2 — stderr
 * becomes the block reason). `PostToolUse`/`UserPromptSubmit`/`SessionStart`/
 * `SessionEnd`/`Stop` are fire-and-forget: the command runs, a non-zero exit
 * is surfaced as a warning notification, but nothing is blocked or
 * transformed. This is a deliberate, honestly-scoped simplification, not an
 * oversight — blocking/transforming user input on submit is a sharper edge
 * left for a later pass if actually needed.
 *
 * Hook commands are spawned directly (not via `pi.exec()`, which has no way
 * to pipe stdin) so the event payload can be written to the command's stdin.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findProjectEchoDir, globalEchoDir } from "echo-core";

type HookEventName = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "SessionStart" | "SessionEnd" | "Stop";

interface HookCommand {
	type: "command";
	command: string;
	/** Max time to wait for the command, in ms. Default 30000. */
	timeout?: number;
}

interface HookMatcher {
	/** Regex tested against the tool name. PreToolUse/PostToolUse only; ignored elsewhere. Omit to match every tool. */
	matcher?: string;
	hooks: HookCommand[];
}

type HooksByEvent = Partial<Record<HookEventName, HookMatcher[]>>;

interface HooksFile {
	hooks?: HooksByEvent;
}

interface HookRunResult {
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function configFilePath(dir: string): string {
	return path.join(dir, "hooks.json");
}

function readConfigFile(filePath: string): HooksByEvent {
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as HooksFile;
		return parsed.hooks ?? {};
	} catch {
		return {};
	}
}

/** Hooks from both scopes run together (additive) — unlike echo-permissions' first-match-wins rules. */
function loadMergedHooks(cwd: string): HooksByEvent {
	const global = readConfigFile(configFilePath(globalEchoDir()));
	const project = readConfigFile(configFilePath(findProjectEchoDir(cwd)));
	const merged: HooksByEvent = {};
	const eventNames: HookEventName[] = [
		"PreToolUse",
		"PostToolUse",
		"UserPromptSubmit",
		"SessionStart",
		"SessionEnd",
		"Stop",
	];
	for (const name of eventNames) {
		const combined = [...(global[name] ?? []), ...(project[name] ?? [])];
		if (combined.length > 0) merged[name] = combined;
	}
	return merged;
}

function matchersFor(config: HooksByEvent, eventName: HookEventName, toolName: string | undefined): HookCommand[] {
	const matchers = config[eventName] ?? [];
	const commands: HookCommand[] = [];
	for (const m of matchers) {
		if (m.matcher && toolName !== undefined) {
			try {
				if (!new RegExp(m.matcher).test(toolName)) continue;
			} catch {
				continue; // malformed matcher never silently matches everything
			}
		}
		commands.push(...m.hooks);
	}
	return commands;
}

function runHookCommand(hook: HookCommand, payload: unknown, cwd: string): Promise<HookRunResult> {
	return new Promise((resolve) => {
		const child = spawn(hook.command, { shell: true, cwd, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timer = setTimeout(
			() => {
				timedOut = true;
				child.kill("SIGTERM");
			},
			hook.timeout ?? DEFAULT_TIMEOUT_MS,
		);

		child.stdout?.on("data", (d) => {
			stdout += d.toString();
		});
		child.stderr?.on("data", (d) => {
			stderr += d.toString();
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr, timedOut });
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ code: null, stdout, stderr: `echo-hooks: failed to spawn hook command: ${err.message}`, timedOut });
		});

		child.stdin?.write(JSON.stringify(payload));
		child.stdin?.end();
	});
}

export default function (pi: ExtensionAPI): void {
	async function runFireAndForget(
		eventName: HookEventName,
		toolName: string | undefined,
		payload: unknown,
		ctx: ExtensionContext,
	): Promise<void> {
		const commands = matchersFor(loadMergedHooks(ctx.cwd), eventName, toolName);
		for (const hook of commands) {
			const result = await runHookCommand(hook, payload, ctx.cwd);
			if (result.code !== 0 && ctx.hasUI) {
				const reason = result.timedOut ? "timed out" : `exit ${result.code}`;
				ctx.ui.notify(`echo-hooks: ${eventName} hook ${reason}: ${result.stderr || result.stdout}`, "warning");
			}
		}
	}

	pi.on("tool_call", async (event, ctx) => {
		const commands = matchersFor(loadMergedHooks(ctx.cwd), "PreToolUse", event.toolName);
		for (const hook of commands) {
			const payload = {
				hook_event_name: "PreToolUse",
				session_id: ctx.sessionManager.getSessionId(),
				cwd: ctx.cwd,
				tool_name: event.toolName,
				tool_input: event.input,
			};
			const result = await runHookCommand(hook, payload, ctx.cwd);

			if (result.code === 2) {
				return { block: true, reason: result.stderr.trim() || `Blocked by echo-hooks PreToolUse hook: ${hook.command}` };
			}
			if (result.code !== 0 && ctx.hasUI) {
				const reason = result.timedOut ? "timed out" : `exit ${result.code}`;
				ctx.ui.notify(`echo-hooks: PreToolUse hook ${reason}: ${result.stderr || result.stdout}`, "warning");
			}
		}
		return undefined;
	});

	pi.on("tool_result", async (event, ctx) => {
		await runFireAndForget(
			"PostToolUse",
			event.toolName,
			{
				hook_event_name: "PostToolUse",
				session_id: ctx.sessionManager.getSessionId(),
				cwd: ctx.cwd,
				tool_name: event.toolName,
				tool_input: event.input,
				tool_response: { content: event.content, isError: event.isError },
			},
			ctx,
		);
	});

	pi.on("input", async (event, ctx) => {
		await runFireAndForget(
			"UserPromptSubmit",
			undefined,
			{
				hook_event_name: "UserPromptSubmit",
				session_id: ctx.sessionManager.getSessionId(),
				cwd: ctx.cwd,
				prompt: event.text,
			},
			ctx,
		);
		return undefined;
	});

	pi.on("session_start", async (_event, ctx) => {
		await runFireAndForget(
			"SessionStart",
			undefined,
			{ hook_event_name: "SessionStart", session_id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd },
			ctx,
		);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await runFireAndForget(
			"SessionEnd",
			undefined,
			{ hook_event_name: "SessionEnd", session_id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd },
			ctx,
		);
	});

	pi.on("agent_end", async (_event, ctx) => {
		await runFireAndForget(
			"Stop",
			undefined,
			{ hook_event_name: "Stop", session_id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd },
			ctx,
		);
	});
}
