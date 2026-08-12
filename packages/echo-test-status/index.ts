/**
 * echo-test-status
 *
 * A footer badge reflecting pass/fail from the last test/build bash command.
 *
 * Design note: relies on the bash tool's own `isError` field on the
 * `tool_result` event as the pass/fail source, not output text-sniffing.
 * Verified against the installed package's actual `bash.js`, not assumed:
 * the bash tool throws when the exit code is non-zero (rather than
 * returning a result object with a manually-set `isError`), and Pi's
 * generic tool-execution wrapper converts that thrown error into
 * `isError: true` upstream — so by the time this extension's `tool_result`
 * handler sees the event, `isError` already accurately reflects the real
 * exit code, the same authoritative source `echo-ci` uses for
 * `tool_execution_end`.
 *
 * Command matching is a pattern list covering common test/build tools
 * (npm/yarn/pnpm, cargo, go, pytest, mvn, make, gradle) — necessarily
 * incomplete for anything not on the list, stated plainly rather than
 * implying full coverage. Each pattern carries its own label rather than
 * re-deriving "test" vs "build" from the command text separately — found via
 * testing that a word-boundary re-derivation mislabels `pytest -v` as
 * "check" instead of "test", since "test" isn't its own word inside
 * "pytest". Pairing the label with the pattern that actually matched avoids
 * that class of bug entirely rather than patching the heuristic further.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "echo-test-status";

const PATTERNS: { pattern: RegExp; label: string }[] = [
	{ pattern: /\bnpm\s+(run\s+)?test\b/i, label: "test" },
	{ pattern: /\bnpm\s+(run\s+)?build\b/i, label: "build" },
	{ pattern: /\byarn\s+(run\s+)?test\b/i, label: "test" },
	{ pattern: /\byarn\s+(run\s+)?build\b/i, label: "build" },
	{ pattern: /\bpnpm\s+(run\s+)?test\b/i, label: "test" },
	{ pattern: /\bpnpm\s+(run\s+)?build\b/i, label: "build" },
	{ pattern: /\bcargo\s+test\b/i, label: "test" },
	{ pattern: /\bcargo\s+build\b/i, label: "build" },
	{ pattern: /\bgo\s+test\b/i, label: "test" },
	{ pattern: /\bgo\s+build\b/i, label: "build" },
	{ pattern: /\bpytest\b/i, label: "test" },
	{ pattern: /\bmvn\s+(test|package|install)\b/i, label: "test" },
	{ pattern: /\bmake\s+test\b/i, label: "test" },
	{ pattern: /\bmake\s+build\b/i, label: "build" },
	{ pattern: /\bgradlew?\s+test\b/i, label: "test" },
	{ pattern: /\bgradlew?\s+build\b/i, label: "build" },
];

function classify(command: string): string | undefined {
	return PATTERNS.find(({ pattern }) => pattern.test(command))?.label;
}

export default function (pi: ExtensionAPI): void {
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash") return;

		const command = event.input.command;
		if (typeof command !== "string") return;
		const label = classify(command);
		if (!label) return;

		const icon = event.isError ? ctx.ui.theme.fg("error", "✗") : ctx.ui.theme.fg("success", "✓");
		ctx.ui.setStatus(STATUS_KEY, `${icon} ${ctx.ui.theme.fg("muted", label)}`);
	});
}
