/**
 * echo-git-status
 *
 * A footer indicator showing the current git branch and dirty/clean state.
 *
 * Design note: uses `pi.exec()` (awaits completion — no stdin needed here,
 * unlike echo-hooks/echo-statusline) with a single combined
 * `git status --porcelain=v1 --branch` call rather than two separate `git`
 * invocations, since that one command's `## branch...` header line plus its
 * file-status lines give both branch name and dirty state together. Outside
 * a git repository, or if `git` isn't on PATH, this degrades to showing
 * nothing at all (not an error) — the same graceful-degradation precedent
 * `echo-checkpoints` already established for exactly this situation.
 * Refreshed on `session_start` and after every `turn_end`, matching
 * `echo-statusline`'s cadence.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "echo-git";

interface GitStatus {
	branch: string;
	dirty: boolean;
}

async function getGitStatus(pi: ExtensionAPI, cwd: string): Promise<GitStatus | undefined> {
	try {
		const result = await pi.exec("git", ["status", "--porcelain=v1", "--branch"], { cwd });
		if (result.code !== 0) return undefined;

		const lines = result.stdout.split("\n").filter(Boolean);
		const branchLine = lines.find((l) => l.startsWith("## "));
		if (!branchLine) return undefined;

		// "## main...origin/main [ahead 1]" / "## main" / "## HEAD (no branch)"
		const match = branchLine.slice(3).match(/^([^.\s]+)/);
		const rawBranch = match?.[1];
		// Detached HEAD reports literally as "HEAD", which reads as a bug, not a state —
		// found via testing against real `git status --porcelain --branch` output.
		const branch = !rawBranch || rawBranch === "HEAD" ? "detached" : rawBranch;
		const dirty = lines.some((l) => !l.startsWith("## "));
		return { branch, dirty };
	} catch {
		return undefined;
	}
}

async function refresh(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const status = await getGitStatus(pi, ctx.cwd);
	if (!status) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const icon = status.dirty ? ctx.ui.theme.fg("warning", "●") : ctx.ui.theme.fg("success", "✓");
	ctx.ui.setStatus(STATUS_KEY, `${icon} ${ctx.ui.theme.fg("muted", status.branch)}`);
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		await refresh(pi, ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await refresh(pi, ctx);
	});
}
