# pi-echo-statusline

A configurable status line via one shell command.

## Design note

Today, a custom status line on Pi means writing a whole extension (see Pi's own official `status-line.ts` example). This package makes it a config file instead. Refreshed on `session_start` and after every `turn_end` — not on a fixed wall-clock timer, a deliberate scope simplification (no timer to clean up on `session_shutdown`, no risk of a runaway interval). The command receives a JSON payload on stdin (`cwd`, `model`, `session_id`, context usage) using only fields actually available from `ExtensionContext`. Output is rendered as-is (first line, trimmed) via `ctx.ui.setStatus()`.

**Live-verified against a real completed turn**, not just type-checked: both refreshes fired with correct data — `session_start` reported `{tokens: 0, ...}` before any turn, and the post-`turn_end` refresh correctly reported `{tokens: 2979, ...}` matching the actual usage from that real turn, with the correct live model id (`gpt-5.5`) and context window (`272000`) flowing through.

## Usage

Configure in `.pi/echo/statusline.json` (project) or `~/.pi/agent/echo/statusline.json` (global; project wins outright — a status line is one choice, not additive):

```json
{ "command": "./scripts/statusline.sh", "timeout": 5000 }
```

`/statusline` shows the configured command and refreshes it immediately.
