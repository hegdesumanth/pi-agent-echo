/**
 * echo-statusline
 *
 * A configurable status line via one shell command — today, doing this on Pi
 * means writing a whole extension (see Pi's own official `status-line.ts`
 * example); this package makes it a config file instead, no code required.
 *
 * Design note: refreshed on `session_start` and after every `turn_end`, not
 * on a fixed wall-clock timer — a deliberate scope simplification (no timer
 * to clean up on `session_shutdown`, no risk of a runaway interval). The
 * command receives a JSON payload on stdin (`cwd`, `model`, `session_id`,
 * `context` usage) using only fields actually available from
 * `ExtensionContext`. Command output is rendered as-is (trimmed to its first
 * line) via `ctx.ui.setStatus()`, the same primitive Pi's own
 * `status-line.ts` example demonstrates.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findProjectEchoDir, globalEchoDir } from "echo-core";

const DEFAULT_TIMEOUT_MS = 5_000;
const STATUS_KEY = "echo-statusline";

interface StatuslineConfig {
	command?: string;
	timeout?: number;
}

function configFilePath(dir: string): string {
	return path.join(dir, "statusline.json");
}

function readConfig(filePath: string): StatuslineConfig | undefined {
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		return JSON.parse(raw) as StatuslineConfig;
	} catch {
		return undefined;
	}
}

/** Project config wins outright over global — a status line is a single choice, not additive like echo-hooks. */
function loadConfig(cwd: string): StatuslineConfig | undefined {
	return readConfig(configFilePath(findProjectEchoDir(cwd))) ?? readConfig(configFilePath(globalEchoDir()));
}

function runCommand(command: string, payload: unknown, cwd: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve) => {
		const child = spawn(command, { shell: true, cwd, stdio: ["pipe", "pipe", "ignore"] });
		let stdout = "";
		let settled = false;

		const finish = (value: string) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			finish("");
		}, timeoutMs);

		child.stdout?.on("data", (d) => {
			stdout += d.toString();
		});
		child.on("close", () => {
			clearTimeout(timer);
			finish(stdout);
		});
		child.on("error", () => {
			clearTimeout(timer);
			finish("");
		});

		child.stdin?.write(JSON.stringify(payload));
		child.stdin?.end();
	});
}

async function refresh(ctx: ExtensionContext): Promise<void> {
	const config = loadConfig(ctx.cwd);
	if (!config?.command) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}

	const usage = ctx.getContextUsage();
	const payload = {
		hook_event_name: "Status",
		session_id: ctx.sessionManager.getSessionId(),
		cwd: ctx.cwd,
		model: ctx.model ? { id: ctx.model.id } : undefined,
		context: usage ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent } : undefined,
	};

	const output = await runCommand(config.command, payload, ctx.cwd, config.timeout ?? DEFAULT_TIMEOUT_MS);
	const firstLine = output.split("\n")[0]?.trim();
	ctx.ui.setStatus(STATUS_KEY, firstLine || undefined);
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		await refresh(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await refresh(ctx);
	});

	pi.registerCommand("statusline", {
		description: "Show the configured status-line command and refresh it now",
		handler: async (_args, ctx) => {
			const config = loadConfig(ctx.cwd);
			if (!config?.command) {
				ctx.ui.notify(
					`No status-line command configured. Add one to ${configFilePath(findProjectEchoDir(ctx.cwd))} (project) or ${configFilePath(globalEchoDir())} (global):\n{"command": "your-script.sh"}`,
					"info",
				);
				return;
			}
			await refresh(ctx);
			ctx.ui.notify(`Status-line command: ${config.command}`, "info");
		},
	});
}
