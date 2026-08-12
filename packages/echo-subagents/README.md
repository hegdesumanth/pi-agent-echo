# echo-subagents

Delegate tasks to specialized subagents with isolated context, adapted from Pi's own official `subagent` example.

## Design note

Each invocation spawns a separate `pi` child process (`--mode json -p --no-session [--model x] [--tools a,b,c] --append-system-prompt <tmpfile> "Task: ..."`), parsing newline-delimited JSON events from stdout to reconstruct messages, usage, and cost. This gives true OS-level context isolation for free — no `SessionManager.fork()`/worktree isolation needed, and no risk of the subagent's conversation bleeding into the parent's context or vice versa, since it's a genuinely separate process with `--no-session`.

This package trades the official example's rich TUI rendering (custom `renderCall`/`renderResult` with themed `Container` output) for the default tool-result display, to keep this module smaller. The mechanism itself — subprocess spawn, JSON-event parsing, `.md`-frontmatter agent discovery (`agents.ts`, vendored verbatim from the official example), single/parallel (max 8, concurrency 4)/chain execution modes — is preserved in full. Richer rendering can be layered on later without touching this logic.

## Permission-gate composition — read this before relying on it

Verified directly against the installed `@earendil-works/pi-coding-agent` source (`dist/main.js`): extension auto-discovery for a spawned child process is entirely independent of `--no-session` — it's driven by resource-loader options, unrelated to session persistence. Project-local extensions (like `echo-permissions`, if installed to `.pi/extensions/`) still require **project trust**, and trust is resolved per-cwd from a persistent trust store shared between parent and child process.

In the near-universal case — the user's own interactive session already trusted this project before ever invoking a subagent — the child reads that same cached trust and `echo-permissions`' gate applies to the subagent's tool calls exactly as it does to the parent's. **In the narrow edge case of a project that has never been interactively trusted, a headless child cannot answer a trust prompt, and project-local extensions (including `echo-permissions` itself) silently do not load for that child.** This is documented in `SECURITY.md`, not silently assumed away — if you need the gate to unconditionally apply to subagents even on a project's very first run, trust the project once interactively before using `/subagent`, or pass explicit `-e` flags in a custom wrapper around this tool (not implemented here).

## Usage

Install locally for development: `pi -e ./packages/echo-subagents`. Agent definitions are `.md` files with YAML-ish frontmatter (`name`, `description`, optional `tools` comma-list, optional `model`), discovered from `~/.pi/agent/agents/` (user scope, default) and/or the nearest ancestor `.pi/agents/` (project scope, opt-in via `agentScope: "both"` or `"project"` — gated behind a confirmation prompt since project agents are repo-controlled). See `examples/agents/` in this package for two starter definitions (`scout.md`, `reviewer.md`) — copy them to `~/.pi/agent/agents/` (or a project's `.pi/agents/`) to try them; they are not auto-installed anywhere by this package.

```
subagent({ agent: "scout", task: "find where the auth middleware is registered" })
subagent({ tasks: [{agent: "scout", task: "..."}, {agent: "reviewer", task: "..."}] })
subagent({ chain: [{agent: "scout", task: "find X"}, {agent: "reviewer", task: "review {previous}"}] })
```
