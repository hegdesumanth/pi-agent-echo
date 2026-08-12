/**
 * echo-checkpoints
 *
 * Git-stash-based checkpointing, adapted from Pi's own official
 * `git-checkpoint.ts` example. That example only offers a reactive restore
 * when the user forks a session (`session_before_fork`); this package keeps
 * that behavior and adds an explicit `/rewind [n]` command so a checkpoint
 * can be restored on demand, not only via fork.
 *
 * Design note: this uses `pi.exec("git", ["stash", "create"])` at the start
 * of every turn (same as the official example) — `stash create` snapshots
 * the working tree WITHOUT touching it, so it's non-destructive to capture.
 * Restoring uses `git stash apply <ref>` (not `pop`), so a restore is itself
 * repeatable and never deletes the stash entry. This is NOT a version-control
 * replacement — it has no notion of commit history, branches, or diffing
 * between checkpoints; it is a single working-tree snapshot per turn.
 *
 * Deliberate scope decisions for this checkpoint mechanism:
 *   - Retention is bounded to the last 100 checkpoints (Map eviction) —
 *     enough to cover a normal working session without unbounded growth.
 *   - Because `git stash create` snapshots the ENTIRE working tree
 *     regardless of which tool caused a change, bash-driven file changes
 *     ARE captured here too, not just edit/write-tool changes — broader
 *     coverage than an edit/write-only checkpoint scheme would give.
 *   - Symlinks are handled by git's own stash mechanism (git tracks them as
 *     symlink blobs) — no special-casing needed here.
 *   - Sub-agent edits (via echo-subagents) run in an entirely separate `pi`
 *     process operating on the same working tree; a checkpoint taken by the
 *     parent process before the subagent runs still captures pre-subagent
 *     state correctly, since it's a filesystem snapshot, not a session-scoped
 *     one. What is NOT captured is a checkpoint *for* the subagent's own
 *     turns, since the subagent's `--no-session` child never registers
 *     `turn_start` checkpoints of its own.
 *   - The very first turn in a brand-new session has no checkpoint, because
 *     the current-entry tracking (below) only becomes populated after the
 *     first `tool_result` fires — inherited from the official example's
 *     design, not new here.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const MAX_CHECKPOINTS = 100;

interface CheckpointRecord {
	entryId: string;
	ref: string;
	createdAt: number;
}

export default function (pi: ExtensionAPI): void {
	const checkpoints = new Map<string, CheckpointRecord>();
	let currentEntryId: string | undefined;

	function recordCheckpoint(entryId: string, ref: string): void {
		checkpoints.set(entryId, { entryId, ref, createdAt: Date.now() });
		if (checkpoints.size > MAX_CHECKPOINTS) {
			const oldestKey = checkpoints.keys().next().value;
			if (oldestKey !== undefined) checkpoints.delete(oldestKey);
		}
	}

	// Track the current entry id, same pattern as Pi's own official example.
	pi.on("tool_result", async (_event, ctx) => {
		const leaf = ctx.sessionManager.getLeafEntry();
		if (leaf) currentEntryId = leaf.id;
	});

	pi.on("turn_start", async (_event, ctx) => {
		const { stdout } = await pi.exec("git", ["stash", "create"], { cwd: ctx.cwd });
		const ref = stdout.trim();
		if (ref && currentEntryId) {
			recordCheckpoint(currentEntryId, ref);
		}
	});

	// Reactive restore-on-fork, kept from the official example.
	pi.on("session_before_fork", async (event, ctx) => {
		const record = checkpoints.get(event.entryId);
		if (!record) return;
		if (!ctx.hasUI) return;

		const choice = await ctx.ui.select("Restore code state?", [
			"Yes, restore code to that point",
			"No, keep current code",
		]);

		if (choice?.startsWith("Yes")) {
			await pi.exec("git", ["stash", "apply", record.ref], { cwd: ctx.cwd });
			ctx.ui.notify("Code restored to checkpoint", "info");
		}
	});

	// New: explicit on-demand restore, not gated behind forking.
	pi.registerCommand("rewind", {
		description: "List recent checkpoints and restore working-tree + session state to one of them",
		handler: async (args, ctx: ExtensionCommandContext) => {
			if (checkpoints.size === 0) {
				ctx.ui.notify("No checkpoints recorded yet in this session.", "info");
				return;
			}

			const leafId = ctx.sessionManager.getLeafId();
			const branch = leafId ? ctx.sessionManager.getBranch(leafId) : [];
			const branchIds = new Set(branch.map((e) => e.id));

			// Only offer checkpoints reachable from the current leaf (ancestors), most recent first.
			const candidates = [...checkpoints.values()].filter((c) => branchIds.has(c.entryId)).reverse();

			if (candidates.length === 0) {
				ctx.ui.notify("No checkpoints found on the current branch.", "info");
				return;
			}

			const requestedIndex = args.trim() ? Number.parseInt(args.trim(), 10) : undefined;
			let selected: CheckpointRecord | undefined;

			if (requestedIndex !== undefined) {
				selected = candidates[requestedIndex - 1];
				if (!selected) {
					ctx.ui.notify(`No checkpoint #${requestedIndex}. Run /rewind with no arguments to list them.`, "error");
					return;
				}
			} else if (!ctx.hasUI) {
				ctx.ui.notify("Usage: /rewind <n> (headless mode requires an explicit checkpoint number)", "error");
				return;
			} else {
				const labels = candidates.map(
					(c, i) => `${i + 1}. ${new Date(c.createdAt).toLocaleTimeString()} (${c.ref.slice(0, 12)})`,
				);
				const choice = await ctx.ui.select("Rewind to which checkpoint?", labels);
				if (!choice) return;
				selected = candidates[labels.indexOf(choice)];
			}

			if (!selected) return;

			await pi.exec("git", ["stash", "apply", selected.ref], { cwd: ctx.cwd });
			await ctx.navigateTree(selected.entryId);
			ctx.ui.notify(
				`Restored working tree and session state to the checkpoint from ${new Date(selected.createdAt).toLocaleTimeString()}.`,
				"info",
			);
		},
	});
}
