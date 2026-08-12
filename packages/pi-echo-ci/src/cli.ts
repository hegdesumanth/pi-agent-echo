#!/usr/bin/env node
/**
 * pi-echo-ci
 *
 * A CI/headless ergonomics wrapper around `pi`'s existing `--mode json -p`
 * print mode — NOT a pi extension (no `pi.on`/`registerTool` here, no "pi"
 * manifest in package.json). It spawns `pi` as a subprocess, parses its
 * NDJSON event stream into a structured summary, and exits with a
 * documented, stable code — the actual pass/fail signal a CI pipeline
 * needs, which raw `pi -p` output doesn't package up on its own.
 *
 * Design note: `pi`'s own exit code is authoritative for "did the pi process
 * itself succeed" (covers missing API key, model errors, etc.) — this
 * wrapper forwards it rather than reinventing it. What it adds: a structured
 * summary (turn count, tool-call count, tool errors, final text) built from
 * the real, currently-verified `AgentEvent` shape (`tool_execution_end`'s
 * `isError` field, not string-sniffing), a `--timeout` safety net pi itself
 * doesn't have, and an optional `--fail-on-tool-error` for the common CI
 * case where "the agent's own actions failed" should fail the build even
 * though pi's own process exited 0.
 *
 * Uses `cross-spawn` rather than `node:child_process.spawn` directly — found
 * via live testing (not assumed) that plain `spawn("pi", ...)` fails with
 * `ENOENT` on Windows, because npm installs `pi` as a `.cmd` shim that Node's
 * own spawn doesn't resolve without `shell: true`. Worse, that failure landed
 * in the generic `proc.on("error")` handler, which resolved exit code 1 —
 * indistinguishable from `pi` itself failing, so every manual test run
 * silently never invoked `pi` at all. `cross-spawn` (already a proven,
 * widely-used dependency inside `pi-coding-agent`'s own dependency tree) is
 * the standard fix for this exact class of bug, with proper argument
 * escaping — safer than reaching for `shell: true` by hand.
 */

import { processLine } from "./parse-events.ts";
import { createAccumulator, toSummary } from "./types.ts";
import spawn from "cross-spawn";

interface CliOptions {
	prompt: string;
	model?: string;
	tools?: string;
	cwd?: string;
	timeoutMs?: number;
	failOnToolError: boolean;
	json: boolean;
	extensions: string[];
}

function printUsage(): void {
	console.error(`Usage: pi-echo-ci <prompt> [options]

Options:
  --model <name>          Passed through to \`pi --model\`
  --tools <a,b,c>         Passed through to \`pi --tools\`
  --extension <path>      Passed through to \`pi --extension\` (repeatable)
  --cwd <path>            Working directory for the pi process
  --timeout <ms>          Kill pi if it runs longer than this
  --fail-on-tool-error    Exit non-zero if any tool call errored, even if pi itself exited 0
  --json                  Print the summary as JSON instead of human-readable text

Exit codes:
  0  pi exited successfully (and, with --fail-on-tool-error, no tool call errored)
  1  pi itself exited non-zero (forwarded as-is)
  2  pi-echo-ci's own --timeout was hit; the pi process was killed
  3  a tool call errored and --fail-on-tool-error was set
  4  usage error (no prompt given)`);
}

function parseArgs(argv: string[]): CliOptions {
	const args = [...argv];
	const extensions: string[] = [];
	let model: string | undefined;
	let tools: string | undefined;
	let cwd: string | undefined;
	let timeoutMs: number | undefined;
	let failOnToolError = false;
	let json = false;
	let prompt: string | undefined;

	while (args.length > 0) {
		const arg = args.shift() as string;
		switch (arg) {
			case "--model":
				model = args.shift();
				break;
			case "--tools":
				tools = args.shift();
				break;
			case "--cwd":
				cwd = args.shift();
				break;
			case "--timeout":
				timeoutMs = Number.parseInt(args.shift() ?? "", 10);
				break;
			case "--extension":
			case "-e": {
				const ext = args.shift();
				if (ext) extensions.push(ext);
				break;
			}
			case "--fail-on-tool-error":
				failOnToolError = true;
				break;
			case "--json":
				json = true;
				break;
			case "--help":
			case "-h":
				printUsage();
				process.exit(0);
				break;
			default:
				prompt = prompt === undefined ? arg : `${prompt} ${arg}`;
		}
	}

	if (!prompt) {
		printUsage();
		process.exit(4);
	}

	return { prompt, model, tools, cwd, timeoutMs, failOnToolError, json, extensions };
}

async function main(): Promise<void> {
	const opts = parseArgs(process.argv.slice(2));

	const piArgs: string[] = ["--mode", "json", "-p", "--no-session"];
	if (opts.model) piArgs.push("--model", opts.model);
	if (opts.tools) piArgs.push("--tools", opts.tools);
	for (const ext of opts.extensions) piArgs.push("--extension", ext);
	piArgs.push(opts.prompt);

	const acc = createAccumulator();
	let buffer = "";
	let timedOut = false;

	const exitCode = await new Promise<number>((resolve) => {
		const proc = spawn("pi", piArgs, { cwd: opts.cwd, shell: false, stdio: ["ignore", "pipe", "inherit"] });

		let timer: NodeJS.Timeout | undefined;
		if (opts.timeoutMs) {
			timer = setTimeout(() => {
				timedOut = true;
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
			}, opts.timeoutMs);
		}

		proc.stdout?.on("data", (data) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) processLine(line, acc);
		});

		proc.on("close", (code) => {
			if (timer) clearTimeout(timer);
			if (buffer.trim()) processLine(buffer, acc);
			resolve(code ?? 1);
		});

		proc.on("error", (err) => {
			if (timer) clearTimeout(timer);
			// Surfaced explicitly rather than silently resolving 1 — an actual missing/unspawnable
			// `pi` binary should say so, not look identical to pi itself exiting with an error.
			acc.rawLines.push(`pi-echo-ci: failed to spawn "pi": ${err.message}`);
			resolve(1);
		});
	});

	const summary = toSummary(acc);

	if (opts.json) {
		console.log(JSON.stringify({ ...summary, piExitCode: exitCode, timedOut }, null, 2));
	} else {
		const errorNames = summary.toolErrorNames.length ? ` (${summary.toolErrorNames.join(", ")})` : "";
		console.log(`Turns: ${summary.turns}  Tool calls: ${summary.toolCalls}  Tool errors: ${summary.toolErrors}${errorNames}`);
		if (summary.stopReason) console.log(`Stop reason: ${summary.stopReason}`);
		if (summary.errorMessage) console.log(`Error: ${summary.errorMessage}`);
		if (summary.finalText) console.log(`\n${summary.finalText}`);
		// Surface pi's raw (non-JSON) output on failure — this is often the ONLY explanation
		// available, e.g. a plain-text "No API key found" printed before any JSON event fires.
		if (exitCode !== 0 && summary.rawLines.length > 0) {
			console.log(`\n--- pi output ---\n${summary.rawLines.join("\n")}`);
		}
	}

	if (timedOut) {
		console.error(`pi-echo-ci: killed pi after exceeding --timeout ${opts.timeoutMs}ms`);
		process.exit(2);
	}
	if (exitCode !== 0) {
		process.exit(1);
	}
	if (opts.failOnToolError && summary.toolErrors > 0) {
		console.error(`pi-echo-ci: --fail-on-tool-error set and ${summary.toolErrors} tool call(s) errored`);
		process.exit(3);
	}
	process.exit(0);
}

main();
