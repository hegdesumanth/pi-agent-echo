/**
 * echo-themes
 *
 * Ships the echo-signal theme pair (dark/light — a teal "signal" accent with
 * a deliberately-designed thinking-level gradient, see themes/*.json) plus a
 * matching welcome header.
 *
 * Design note: the header does NOT hardcode echo-signal's specific hex
 * values. It uses `theme.fg()` with the seven thinking-level tokens
 * (`thinkingOff` -> `thinkingMax`) and the `accent` token — tokens every Pi
 * theme defines, not just this one (confirmed against the installed
 * package's `ThemeColor` type) — so the header looks coherent whether
 * echo-signal, a built-in theme, or a third-party theme is actually active.
 * The status line lists real, currently-registered `echo-*` slash commands
 * (via `pi.getCommands()`), not a package count: some echo packages (like
 * `echo-hooks`) register no tools or commands at all, so a package count
 * can't be computed reliably from Pi's extension API — a command list is
 * the honestly-computable equivalent, not a downgrade for its own sake.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";

const THINKING_TOKENS = [
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"thinkingMax",
] as const;
const WAVE_CHARS = ["▁", "▂", "▃", "▅", "▆", "▇", "█"];

function renderWave(theme: Theme): string {
	return THINKING_TOKENS.map((token, i) => theme.fg(token, WAVE_CHARS[i] ?? "")).join("");
}

function echoCommandHints(pi: ExtensionAPI): string {
	const names = pi
		.getCommands()
		.filter((c) => c.sourceInfo.path.includes("echo-"))
		.map((c) => `/${c.name}`);
	const unique = [...new Set(names)].slice(0, 5);
	return unique.length > 0 ? unique.join("  ") : "/help";
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setHeader((_tui, theme) => ({
			render(_width: number): string[] {
				const wave = renderWave(theme);
				const wordmark = theme.bold(theme.fg("accent", "echo"));
				const tagline = theme.fg("dim", `extended workflow for pi · v${VERSION}`);
				const hints = theme.fg("muted", echoCommandHints(pi));
				return ["", `${wave}  ${wordmark}`, tagline, hints, ""];
			},
			invalidate() {},
		}));
	});

	pi.registerCommand("builtin-header", {
		description: "Restore Pi's built-in header",
		handler: async (_args, ctx) => {
			ctx.ui.setHeader(undefined);
			ctx.ui.notify("Built-in header restored", "info");
		},
	});
}
