# echo-ci

A CI/headless ergonomics wrapper around `pi`'s existing `--mode json -p` print mode. **This is not a Pi extension** — it's a standalone CLI (no `pi.on`/`registerTool`, no `"pi"` manifest field) that spawns `pi` as a subprocess.

## Design note

`pi`'s own exit code is authoritative for "did the pi process itself succeed" (covers a missing API key, model errors, etc.) — this wrapper forwards it rather than reinventing it. What it adds: a structured summary (turn count, tool-call count, tool errors by name, final assistant text) built from the real, currently-verified `AgentEvent` shape (`tool_execution_end`'s `isError` field is the authoritative source for tool failure, not string-sniffing message content), an optional `--timeout` safety net pi itself doesn't have, and `--fail-on-tool-error` for the common CI case where "the agent's own actions failed" should fail the build even though pi's own process exited 0.

## Two real bugs found via live testing against the actual `pi` binary, not just type-checking

1. **Non-JSON output was silently discarded.** `pi` can print a plain-text message (e.g. "No API key found") before ever emitting a JSON event. The first version's parser correctly didn't crash on non-JSON lines but also didn't keep them anywhere — a plain-text startup failure produced an exit code with an empty, unexplained summary. Fixed by keeping the last 20 non-JSON lines in `rawLines` and surfacing them on failure.
2. **`pi` was silently never being invoked at all, on Windows.** The first version used `node:child_process.spawn("pi", ...)` directly. Confirmed via a standalone diagnostic script: this fails with `ENOENT` on Windows, because npm installs `pi` as a `.cmd` shim that Node's spawn doesn't resolve without `shell: true` — and that failure landed in the generic `error` handler, which resolved exit code 1, indistinguishable from `pi` itself failing. Every earlier manual test of this tool had actually been testing nothing. Fixed by switching to `cross-spawn` (already a proven dependency inside `pi-coding-agent`'s own dependency tree) instead of hand-rolling a `shell: true` workaround with its own escaping concerns.

## An operational finding, not a bug: budget your `--timeout` for pi's own exit delay

With a real provider actually completing a turn (verified against `openai-codex`/`gpt-5.5`), a **bare `pi --mode json -p` process — with zero extensions loaded — took ~11-15 seconds to exit after printing `agent_end`/`agent_settled`**, confirmed by comparing against an identical run with an `echo` extension loaded (same delay either way) and a plain `timeout`-wrapped baseline with correctly-captured exit codes (an earlier comparison had been silently wrong: piping through `tail` reports `tail`'s exit code, not `pi`'s). This is native `pi`/provider-connection teardown behavior — not something `echo-ci` or any `echo` package causes or can fix. Practical effect: don't set `--timeout` assuming the process exits the instant the model is done; give it headroom (the real task-relevant work is over once `agent_end` appears in the summary — a timeout killing the process during this native teardown window is a false failure, not evidence the task hung).

## Usage

```
echo-ci <prompt> [options]

  --model <name>          Passed through to `pi --model`
  --tools <a,b,c>         Passed through to `pi --tools`
  --extension <path>      Passed through to `pi --extension` (repeatable)
  --cwd <path>            Working directory for the pi process
  --timeout <ms>          Kill pi if it runs longer than this
  --fail-on-tool-error    Exit non-zero if any tool call errored, even if pi itself exited 0
  --json                  Print the summary as JSON instead of human-readable text
```

Exit codes: `0` success, `1` pi itself exited non-zero (forwarded as-is), `2` echo-ci's own `--timeout` was hit, `3` a tool call errored and `--fail-on-tool-error` was set, `4` usage error.

Example CI invocation, with the permission gate active and locked to a non-interactive-safe mode:
```
echo-ci "Fix the failing test in src/foo.test.ts" \
  --extension ./packages/echo-permissions \
  --fail-on-tool-error \
  --timeout 300000
```
Since there's no human to answer an `ask` prompt in CI, set `echo-permissions`' mode to something CI-appropriate (`acceptEdits` or `dontAsk`) ahead of time via `/permissions mode <mode>` in project state, or rely on the gate's own documented headless default (deny on `ask` with no UI).
