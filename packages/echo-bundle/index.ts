/**
 * echo-bundle
 *
 * Installs and registers all thirteen `echo` extensions in one shot
 * (`pi install npm:echo-bundle`) for people who want everything rather than
 * picking packages one at a time. Each of the other thirteen packages
 * remains independently installable on its own — this is purely additive,
 * none of them changed to make this exist.
 *
 * Mechanism: depends on all thirteen packages as real npm dependencies (so a
 * single `npm install` resolves the whole set, the same way `echo-core`
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
 * Note: `echo-themes` bundles a theme pack (`"pi": {"themes": [...]}`) in
 * addition to its extension — installing echo-bundle makes the themes
 * available to `/theme` the same as installing echo-themes directly would.
 *
 * Design note / real trade-off, not free: Pi's loader treats whatever file
 * it's given as ONE `Extension` (its own `sourceInfo`, handler/tool maps,
 * error attribution). Loading thirteen packages this way means Pi sees a
 * single "echo-bundle" extension, not thirteen independently identifiable
 * ones — if one of them throws during registration, Pi's own
 * extension-loading UI attributes it to "echo-bundle" as a whole, not the
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
import checkpoints from "echo-checkpoints";
import gitStatus from "echo-git-status";
import hooks from "echo-hooks";
import mcpBridge from "echo-mcp-bridge";
import outputStyles from "echo-output-styles";
import permissions from "echo-permissions";
import planMode from "echo-plan-mode";
import statusline from "echo-statusline";
import subagents from "echo-subagents";
import tasks from "echo-tasks";
import testStatus from "echo-test-status";
import themes from "echo-themes";
import todos from "echo-todos";

const EXTENSIONS: { name: string; factory: (pi: ExtensionAPI) => void }[] = [
	{ name: "echo-permissions", factory: permissions },
	{ name: "echo-plan-mode", factory: planMode },
	{ name: "echo-subagents", factory: subagents },
	{ name: "echo-checkpoints", factory: checkpoints },
	{ name: "echo-tasks", factory: tasks },
	{ name: "echo-todos", factory: todos },
	{ name: "echo-output-styles", factory: outputStyles },
	{ name: "echo-mcp-bridge", factory: mcpBridge },
	{ name: "echo-hooks", factory: hooks },
	{ name: "echo-statusline", factory: statusline },
	{ name: "echo-themes", factory: themes },
	{ name: "echo-git-status", factory: gitStatus },
	{ name: "echo-test-status", factory: testStatus },
];

export default function (pi: ExtensionAPI): void {
	for (const { name, factory } of EXTENSIONS) {
		try {
			factory(pi);
		} catch (err) {
			// One bundled package failing to register shouldn't take the other nine down with it.
			const message = err instanceof Error ? err.message : String(err);
			console.error(`echo-bundle: "${name}" failed to register: ${message}`);
		}
	}
}
