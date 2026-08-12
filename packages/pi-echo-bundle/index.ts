/**
 * pi-echo-bundle
 *
 * Installs and registers all thirteen `echo` extensions in one shot
 * (`pi install npm:pi-echo-bundle`) for people who want everything rather
 * than picking packages one at a time. Each of the other thirteen packages
 * remains independently installable on its own — this is purely additive,
 * none of them changed to make this exist.
 *
 * Mechanism: depends on all thirteen packages as real npm dependencies (so a
 * single `npm install` resolves the whole set, the same way `pi-echo-core`
 * resolves for any one of them today), then imports each one's default
 * export and calls it with the same `pi` instance — exactly what passing
 * thirteen separate `-e` flags would do, just pre-composed into one file.
 * This relies only on ordinary Node ancestor `node_modules` resolution, not
 * any Pi-specific glob support — verified against Pi's own source
 * (`resolveExtensionEntries` in `core/package-manager.js`) that a package
 * manifest's `extensions` array resolves via plain `path.resolve()`, not
 * globs, and that auto-discovery explicitly skips `node_modules` — so a
 * "point at your dependencies' folders" approach would NOT have worked;
 * importing each package's factory function directly is what actually does.
 *
 * Note: `pi-echo-themes` bundles a theme pack (`"pi": {"themes": [...]}`) in
 * addition to its extension — installing pi-echo-bundle makes the themes
 * available to `/theme` the same as installing pi-echo-themes directly would.
 *
 * Design note / real trade-off, not free: Pi's loader treats whatever file
 * it's given as ONE `Extension` (its own `sourceInfo`, handler/tool maps,
 * error attribution). Loading thirteen packages this way means Pi sees a
 * single "pi-echo-bundle" extension, not thirteen independently identifiable
 * ones — if one of them throws during registration, Pi's own
 * extension-loading UI attributes it to "pi-echo-bundle" as a whole, not the
 * specific package — mitigated somewhat below (each factory call is
 * individually try/caught and logged by name, so one failing doesn't take
 * the rest down and the failure is still identifiable), but any future
 * per-extension enable/disable UI in Pi would still show one entry, not
 * thirteen, since Pi's loader treats this as a single `Extension`.
 * Installing the packages individually doesn't have that limitation. That's
 * the actual remaining cost of the convenience this package exists to
 * provide — stated plainly, not glossed over.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import checkpoints from "pi-echo-checkpoints";
import gitStatus from "pi-echo-git-status";
import hooks from "pi-echo-hooks";
import mcpBridge from "pi-echo-mcp-bridge";
import outputStyles from "pi-echo-output-styles";
import permissions from "pi-echo-permissions";
import planMode from "pi-echo-plan-mode";
import statusline from "pi-echo-statusline";
import subagents from "pi-echo-subagents";
import tasks from "pi-echo-tasks";
import testStatus from "pi-echo-test-status";
import themes from "pi-echo-themes";
import todos from "pi-echo-todos";

const EXTENSIONS: { name: string; factory: (pi: ExtensionAPI) => void }[] = [
	{ name: "pi-echo-permissions", factory: permissions },
	{ name: "pi-echo-plan-mode", factory: planMode },
	{ name: "pi-echo-subagents", factory: subagents },
	{ name: "pi-echo-checkpoints", factory: checkpoints },
	{ name: "pi-echo-tasks", factory: tasks },
	{ name: "pi-echo-todos", factory: todos },
	{ name: "pi-echo-output-styles", factory: outputStyles },
	{ name: "pi-echo-mcp-bridge", factory: mcpBridge },
	{ name: "pi-echo-hooks", factory: hooks },
	{ name: "pi-echo-statusline", factory: statusline },
	{ name: "pi-echo-themes", factory: themes },
	{ name: "pi-echo-git-status", factory: gitStatus },
	{ name: "pi-echo-test-status", factory: testStatus },
];

export default function (pi: ExtensionAPI): void {
	for (const { name, factory } of EXTENSIONS) {
		try {
			factory(pi);
		} catch (err) {
			// One bundled package failing to register shouldn't take the other nine down with it.
			const message = err instanceof Error ? err.message : String(err);
			console.error(`pi-echo-bundle: "${name}" failed to register: ${message}`);
		}
	}
}
