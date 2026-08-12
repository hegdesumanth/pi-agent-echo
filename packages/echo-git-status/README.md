# echo-git-status

A footer indicator showing the current git branch and dirty/clean state (`✓ main` or `● feature-branch`).

## Design note

Uses `pi.exec()` with a single combined `git status --porcelain=v1 --branch` call rather than two separate `git` invocations — one command's `## branch...` header line plus its file-status lines give both branch name and dirty state together. Outside a git repository, or if `git` isn't on PATH, this degrades to showing nothing at all, not an error — the same graceful-degradation precedent `echo-checkpoints` already established for exactly this situation. Refreshed on `session_start` and after every `turn_end`, matching `echo-statusline`'s cadence.

**Found via testing against real `git status --porcelain --branch` output, not assumed:** a detached HEAD reports its branch header literally as `## HEAD (no branch)` — without special-casing it, the indicator would show `✓ HEAD`, which reads as a bug rather than a state. Fixed to show `detached` instead. Verified the fix against real output for a dirty branch, a clean branch with remote-tracking info (`main...origin/main`), an ahead/behind branch, and the detached case.

## Usage

No configuration — install it and the indicator just appears in the footer whenever the current directory is inside a git repository.
