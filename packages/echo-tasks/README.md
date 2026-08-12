# echo-tasks

A background job tool with pollable status — Pi's built-in `bash` tool always runs to completion before returning; this fills that gap.

## Design note

Spawns directly via `node:child_process` rather than reusing Pi's own bash-tool operations (`createLocalBashOperations`/`execCommand`), since those are built to await completion — exactly what a background task needs to avoid. Tasks are tracked in-memory only, for the lifetime of the current `pi` process: they are **not** persisted across a session reload/resume (a spawned child process can't be reconstructed from a JSON session entry), and are **not** automatically killed when `pi` exits (inherited default Node child-process behavior — use `kill_task` before quitting if that matters to you). Output is capped via a bounded rolling buffer (`truncateTail`, reused from `@earendil-works/pi-coding-agent` rather than hand-rolled) so a chatty long-running process can't grow memory unboundedly.

## Usage

Three model-callable tools:
- `run_task({command, cwd?})` — starts immediately, returns a task id right away.
- `task_status({taskId})` — current status + tail of stdout/stderr.
- `kill_task({taskId})` — SIGTERM, then SIGKILL after a 5s grace period if still running.

Plus `/tasks` for a human-readable list of everything tracked in the current session.
