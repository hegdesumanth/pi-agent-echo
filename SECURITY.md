# Security

`echo` is a set of Pi packages (extensions). Per Pi's own documentation:

> Pi packages run with full system access... extensions execute arbitrary code, and skills can instruct the model to perform any action including running executables. Review source code before installing third-party packages.

Everything below assumes you have already accepted that baseline. `echo` does not change it, and no `echo` package should ever be described as making Pi "safe" in an absolute sense — only as adding a cooperative, in-process layer of friction and auditability on top of what Pi already grants.

## What `pi-echo-permissions` actually protects against

- **Cooperative gating of every tool call Pi's own extension API surfaces.** `pi-echo-permissions` hooks Pi's `tool_call` event, which fires for every built-in tool (`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`) and every custom tool registered by any extension, including ones registered by other `echo` packages or third-party packages loaded in the same session. This is a real, load-bearing checkpoint — a well-behaved model routed through Pi's normal tool-calling path cannot silently write to `.env`, `~/.ssh/`, `node_modules/`, or `echo`'s own policy files, regardless of what mode is active (protected paths are checked before mode, and are not bypassable even in `bypass` mode — this is deliberate and tested).
- **A five-way mode enum** (`manual`/`acceptEdits`/`plan`/`dontAsk`/`bypass`), so the level of friction is explicit and switchable per project, not hardcoded.

## What it does not protect against (by design, not oversight)

- **No OS-level sandbox.** A bash command that `pi-echo-permissions` allows can still do anything a shell running as the current user can do — there is no seccomp filter, container boundary, or filesystem jail here. If you need that, see Pi's own `containerization.md` (Gondolin/Docker/OpenShell patterns) — `echo` deliberately does not reimplement it.
- **The bash protected-path check is a best-effort substring scan, not a parser.** `input.command` is matched as a plain string against the protected-paths list. Chained commands, `$()` command substitution, and other obfuscation can defeat it. This is a documented gap, exercised explicitly in manual testing, not something to assume away.
- **A future extension that adds a filesystem- or network-touching tool without going through Pi's standard `tool_call` event is invisible to `pi-echo-permissions` by construction.** The gate only sees what Pi's event bus shows it.
- **`permissions.json`/`state.json` are protected against the *model* editing them via `write`/`edit`, not against a human directly editing the files on disk.** That's an intentional scope boundary — defending against a human operator's own filesystem access isn't a threat this system is meant to address.
- **Plan mode's tool restriction (`setActiveTools()`) is best-effort UX, not the security boundary.** The actual boundary is `pi-echo-permissions`' `evaluate()` plan-mode branch, which is checked independently and would still deny a stray call even if the tool-swap were somehow out of sync with the stored mode.

## Phase B additions

### `pi-echo-subagents`

- **Subagents run as separate `pi` child processes and inherit whatever credentials/environment the parent process has** (API keys, OAuth tokens, filesystem access) — there is no reduced-privilege sandboxing of the child; it is exactly as powerful as the parent, just context-isolated.
- **`pi-echo-permissions`' gate reaches a subagent's tool calls ONLY if the project has already been interactively trusted at least once.** Verified directly against the installed `@earendil-works/pi-coding-agent` source (`dist/main.js`): extension auto-discovery for a spawned child is independent of `--no-session`, but project-local extensions (like `pi-echo-permissions`) still require project trust, resolved per-cwd from a shared persistent trust store. In the near-universal case (the user's own session already trusted the project), the child inherits that trust and the gate applies normally. **On a project's very first-ever run, a headless child cannot answer a trust prompt, and project-local extensions — including `pi-echo-permissions` itself — silently do not load for that child.** This means a subagent invoked before the project has ever been interactively trusted runs with NO permission gate at all. Mitigation: trust the project once interactively (any normal interactive session does this automatically on first run) before relying on `/subagent` to be gated.
- Project-local agent definitions (`.pi/agents/*.md`) are repo-controlled content — `pi-echo-subagents` gates them behind a `ctx.ui.confirm` prompt before ever running one, separately from the tool-permission question above, since a malicious `.md` file committed to a repo could otherwise silently redirect a subagent's entire system prompt.

### `pi-echo-checkpoints`

- Not a security boundary at all — it's a convenience/recovery feature. Restoring a checkpoint (`git stash apply`) re-applies a prior working-tree state; it does not undo anything already sent to a remote (a `git push` that already happened is not reversible by this).
- Requires the project to actually be a git repository; degrades to a silent no-op otherwise (verified: `git stash create` outside a repo resolves with a non-zero exit code rather than throwing, so a turn never crashes because of this).

### `pi-echo-tasks`

- Background tasks run with the same permissions as the `pi` process itself — `run_task` is not routed through `pi-echo-permissions`' `tool_call` gate as a distinct decision point beyond the initial `run_task` call itself (the gate sees `run_task` being called, evaluates it as one tool call, but has no visibility into what the spawned background process subsequently does — it is not re-evaluated per background action the way a synchronous `bash` call's single command is).
- Tasks are not killed automatically when `pi` exits — a background task can keep running after the parent session ends. Use `kill_task` before quitting if that matters.

## Phase C additions

### `pi-echo-mcp-bridge`

- **Bridged MCP tools ARE gated by `pi-echo-permissions`, automatically.** Verified against the installed package's type declarations: every `pi.registerTool()`-registered tool (including these) triggers Pi's `tool_call` event, whose `CustomToolCallEvent.toolName` type covers any string — so an `allow`/`ask`/`deny` rule matching `mcp__<server>__<tool>` (or a wildcard `*` rule) applies exactly as it would to a native tool.
- **What is NOT gated: fine-grained protected-path enforcement.** `pi-echo-core`'s protected-path check only extracts a path from the native `write`/`edit` tools' `path` field, and only substring-scans `bash`'s `command`. It has no way to know that an MCP tool's `arguments` contains a file path. An MCP server capable of writing files (a filesystem server, for instance) is gated only by whatever rule matches its tool name as a whole — add an explicit rule for any such tool (e.g. `/permissions ask mcp__filesystem__write_file`) rather than assuming the protected-paths list covers it.
- **MCP servers run as child processes you configure, with whatever credentials/env you give them** (via `mcp-servers.json`'s `env` field or inherited environment) — an MCP server is, in effect, a third-party binary you're choosing to run, same trust posture as installing any other Pi package.
- **Uses the official `@modelcontextprotocol/sdk`, not an unreviewed community bridge package** — a deliberate choice, given that any dependency here runs with full system access same as the rest of `echo`.
- Connections are closed on `session_shutdown` and before any reconnect on a later `session_start` — found necessary during manual testing (an early version left connections open, which silently kept a `pi -p` one-shot process from exiting after it had otherwise finished).

### `pi-echo-todos` / `pi-echo-output-styles`

Neither introduces a new security-relevant surface. `pi-echo-output-styles`' `before_agent_start` override only appends text to the existing system prompt (see its own design note for why it doesn't fully replace it) and is gated behind the same project-local-file trust model as everything else Pi loads from `.pi/echo/styles/`.
