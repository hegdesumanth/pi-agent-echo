/**
 * echo-output-styles
 *
 * Command-driven persona/tone switching via `before_agent_start`'s
 * `systemPrompt` override capability.
 *
 * Design note: this package APPENDS the active style's text to
 * `ctx.getSystemPrompt()` rather than replacing it outright — a full
 * replacement risks silently discarding the tool-usage guidance baked into
 * Pi's default prompt, which this module has no way to reconstruct on its
 * own. Appending a persona/tone overlay is a smaller, safer claim than
 * "alternate system prompt," and is what's actually built here.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectEchoDir, globalEchoDir } from "echo-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

const BUNDLED_STYLES_DIR = fileURLToPath(new URL("./styles", import.meta.url));
const DEFAULT_STYLE = "default";

interface StyleInfo {
	name: string;
	content: string;
	source: "built-in" | "global" | "project";
}

interface OutputStyleState {
	style: string;
}

function loadStylesFromDir(dir: string, source: StyleInfo["source"]): Map<string, StyleInfo> {
	const styles = new Map<string, StyleInfo>();
	if (!fs.existsSync(dir)) return styles;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return styles;
	}

	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const name = entry.name.slice(0, -3);
		try {
			const content = fs.readFileSync(path.join(dir, entry.name), "utf-8");
			styles.set(name, { name, content, source });
		} catch {
			/* skip unreadable file */
		}
	}
	return styles;
}

function discoverStyles(cwd: string): Map<string, StyleInfo> {
	const merged = new Map<string, StyleInfo>();
	for (const [name, info] of loadStylesFromDir(BUNDLED_STYLES_DIR, "built-in")) merged.set(name, info);
	for (const [name, info] of loadStylesFromDir(path.join(globalEchoDir(), "styles"), "global")) merged.set(name, info);
	for (const [name, info] of loadStylesFromDir(path.join(findProjectEchoDir(cwd), "styles"), "project")) merged.set(name, info);
	return merged;
}

function statePath(cwd: string): string {
	return path.join(findProjectEchoDir(cwd), "output-style.json");
}

async function readActiveStyle(cwd: string): Promise<string> {
	try {
		const raw = await fs.promises.readFile(statePath(cwd), "utf-8");
		const parsed = JSON.parse(raw) as OutputStyleState;
		return parsed.style ?? DEFAULT_STYLE;
	} catch {
		return DEFAULT_STYLE;
	}
}

async function writeActiveStyle(cwd: string, style: string): Promise<void> {
	const file = statePath(cwd);
	await withFileMutationQueue(file, async () => {
		await fs.promises.mkdir(path.dirname(file), { recursive: true });
		await fs.promises.writeFile(file, `${JSON.stringify({ style }, null, 2)}\n`, "utf-8");
	});
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("output-style", {
		description: "Show or switch the active output style",
		handler: async (args, ctx) => {
			const styles = discoverStyles(ctx.cwd);
			const requested = args.trim();

			if (!requested) {
				const active = await readActiveStyle(ctx.cwd);
				const lines = [
					`${active === DEFAULT_STYLE ? "*" : " "} ${DEFAULT_STYLE} (Pi's built-in prompt, unmodified)`,
					...[...styles.values()].map((s) => `${active === s.name ? "*" : " "} ${s.name} (${s.source})`),
				];
				ctx.ui.notify(`Output styles:\n${lines.join("\n")}\n\nUse /output-style <name> to switch.`, "info");
				return;
			}

			if (requested !== DEFAULT_STYLE && !styles.has(requested)) {
				const available = [DEFAULT_STYLE, ...styles.keys()].join(", ");
				ctx.ui.notify(`Unknown style "${requested}". Available: ${available}`, "error");
				return;
			}

			await writeActiveStyle(ctx.cwd, requested);
			ctx.ui.notify(`Output style set to "${requested}".`, "info");
		},
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const active = await readActiveStyle(ctx.cwd);
		if (active === DEFAULT_STYLE) return;

		const styles = discoverStyles(ctx.cwd);
		const style = styles.get(active);
		if (!style) return; // style file removed since it was selected — fall back to default silently

		return {
			systemPrompt: `${ctx.getSystemPrompt()}\n\n${style.content}`,
		};
	});
}
