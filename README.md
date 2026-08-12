# echo

`echo` is a set of installable packages ("Pi packages") for the [`pi`](https://github.com/earendil-works/pi) coding-agent CLI (`@earendil-works/pi-coding-agent`) that layer a fuller workflow on top of Pi's minimal core — a permission gate, plan mode, sub-agents, checkpoints, background tasks, a todo list, output-style switching, no-code hooks, a status line, an MCP bridge, a CI wrapper, a theme pack, and a few small always-visible status widgets (git branch, test/build pass-fail, MCP connection health). Pi's own README states plainly that it "ships powerful defaults but skips features like sub agents and plan mode," expecting third parties to build those as packages. This is that package — coding-domain only, no chat-product chrome.

![echo-signal theme preview — dark and light terminal sessions, thinking-level gradient swatches, and the welcome header](./docs/echo-signal-preview.png)

**Who this is for:** anyone using plain `pi` who wants a fuller set of guardrails and workflow features on top of it — a permission gate, plan mode, checkpoints, sub-agents, and the rest.

Nothing here makes Pi "safe" in an absolute sense. Every package is a cooperative, in-process layer of friction and auditability on top of what Pi already grants — see `SECURITY.md` for exactly what each package does and does not protect against, stated plainly rather than implied.

## Packages

| Package | Adds |
|---|---|
| `echo-core` | Shared types, the pure permission-decision function, and policy/state file I/O — no extension itself, a library the others depend on. |
| `echo-permissions` | A cooperative gate on every tool call: five-way mode (`manual`/`acceptEdits`/`plan`/`dontAsk`/`bypass`) + allow/ask/deny rules + protected paths that can't be overridden even in `bypass` mode. |
| `echo-plan-mode` | Read-only exploration mode with a model-callable `exit_plan_mode` approval gate, sharing its mode flag with `echo-permissions`. |
| `echo-subagents` | Delegates tasks to specialized subagents with true OS-level context isolation (each runs as a separate `pi` process), single/parallel/chain modes, `.md`-frontmatter agent definitions. |
| `echo-checkpoints` | Git-stash-based per-turn snapshots plus an explicit `/rewind [n]` command. |
| `echo-tasks` | Background job tool (`run_task`/`task_status`/`kill_task`) for processes Pi's synchronous `bash` tool can't handle. |
| `echo-todos` | A general-purpose, model-callable todo list (`todo_write`), rendered as a persistent widget. |
| `echo-output-styles` | Command-driven persona/tone switching (`concise`/`explanatory`/`learning` built in, plus project-local custom styles). |
| `echo-mcp-bridge` | Connects to MCP servers over stdio (via the official `@modelcontextprotocol/sdk`) and registers their tools as regular Pi tools, automatically gated by `echo-permissions`. |
| `echo-hooks` | No-code, JSON-configured lifecycle hooks (`PreToolUse`/`PostToolUse`/`UserPromptSubmit`/`SessionStart`/`SessionEnd`/`Stop`) — declare a shell command per event in a config file, no extension code required. |
| `echo-statusline` | Configurable status line rendered from one shell command's output. |
| `echo-ci` | A standalone CLI (not a Pi extension) wrapping `pi --mode json -p` with a structured summary and documented exit codes, for CI/headless use. |
| `echo-themes` | The `echo-signal` dark/light theme pair (teal accent, a deliberately-designed 7-step thinking-level gradient) plus a matching theme-adaptive welcome header. |
| `echo-git-status` | Persistent footer badge showing the current git branch and dirty/clean state, refreshed each turn. |
| `echo-test-status` | Persistent footer badge showing pass/fail (`✓`/`✗`) from the last test/build bash command. |
| `echo-bundle` | Installs and registers all thirteen extensions above in one shot (plus the `echo-themes` theme pack) — for "give me everything" instead of picking packages individually. |

## Quickstart

Cloned the repo directly? Use `./install.sh` — a small convenience installer that calls `pi install <local-path>` instead of copying files, since several of these packages depend on `echo-core` as a real npm dependency and need the workspace built first:

```bash
git clone <this repo> && cd echo
./install.sh                  # everything, global (available in every project)
./install.sh permissions      # just echo-permissions
./install.sh permissions -l   # just echo-permissions, project-local (to wherever you run this from)
```

Or do it by hand:

```bash
npm install -g @earendil-works/pi-coding-agent   # tested against 0.84.0
git clone <this repo> && cd echo && npm install && npm run build

# Try extensions without installing them (temp-loaded for this run only):
pi -e ./packages/echo-permissions -e ./packages/echo-plan-mode
# ...or everything at once:
pi -e ./packages/echo-bundle

# Install for real, project-local:
pi install ./packages/echo-permissions -l
pi install ./packages/echo-plan-mode -l
# ...or, once published, everything at once:
pi install npm:echo-bundle -l
```

Each of the thirteen feature packages is independently installable — pulling in `echo-permissions` does not require `echo-subagents`, etc. `echo-bundle` is purely additive on top of that (see its own `README.md` for the one real trade-off it makes: Pi's loader sees it as a single extension, not thirteen independently identifiable ones). See each package's own `README.md` for its design note and any real limitations found while building it (several were found by actually running the code against a live `pi` process, not just type-checking — worth reading if you're deciding whether to trust a given package).

## What stock Pi doesn't have

Verified against the actual installed `@earendil-works/pi-coding-agent` package (`0.84.0`), not assumed from docs:

| Capability | Stock Pi | `echo`-on-Pi |
|---|---|---|
| Permission gate | None | ✅ 5-mode + rules + protected paths |
| Plan mode | None | ✅ + model-callable approval tool |
| Sub-agents | None | ✅ subprocess-isolated |
| Checkpoints | None | ✅ git-stash + `/rewind` |
| Background tasks | None (bash always awaits completion) | ✅ |
| Todo tracking | None | ✅ |
| Output styles | None | ✅ (appends, doesn't replace default prompt) |
| MCP | None (confirmed absent from core; community bridges exist) | ✅ via official SDK |
| No-code hooks | None (a Pi "hook" means writing an extension) | ✅ `echo-hooks` — declarative, config-file only |
| Status line | None natively (only a code-it-yourself example) | ✅ `echo-statusline` — one configured command |
| CI/headless wrapper | Print/JSON/RPC modes exist, no structured exit-code convention | ✅ `echo-ci` |
| Custom theme pack | Theme system exists, no bundled theme built for this purpose | ✅ `echo-themes` — dark/light pair + welcome header |
| Git/test status at a glance | Footer shows model/thinking/tokens/cost only | ✅ `echo-git-status` + `echo-test-status` badges |

## Docs

- `SECURITY.md` — what each package actually protects against, and what it explicitly does not.
- `docs/MIGRATION.md` — bringing agent definitions, hooks, permission rules, and skills over from another agent CLI with similarly-shaped features.
