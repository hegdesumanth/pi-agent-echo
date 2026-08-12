# Migrating from another agent CLI

This is a short document, deliberately — most of what people expect to be a migration chore turns out to already work, or to need only a small config change rather than a rewrite. It's written for anyone coming from an agent CLI that has similarly-shaped features (agent-definition frontmatter, a todo tool, hooks, MCP config, etc.) — the specific field names below are the common convention most such tools already share.

## Free — nothing to do

- **`CLAUDE.md`/`AGENTS.md`**: Pi natively discovers and loads `AGENTS.md`/`CLAUDE.md` from the global config dir, ancestor directories, and cwd. Keep the file where it is; nothing to convert.
- **Sub-agent frontmatter shape**: `echo-subagents`' `.md` agent definitions use the common convention (`name`, `description`, `tools`, `model` in frontmatter, body as the system prompt) — copy your existing agent `.md` files to `.pi/agents/*.md` (project scope) or `~/.pi/agent/agents/*.md` (user scope) as-is.
- **Todo-tool schema**: `echo-todos`' tool takes the common shape (`{todos: [{content, status, activeForm}]}`, whole-list replace) — no prompting/tooling changes needed if you have instructions elsewhere referencing "the todo tool."
- **Custom slash commands**: Pi natively supports "prompt templates" (`.md` files with frontmatter, `$1`/`$@`/`${1:-default}` argument substitution) that are a full equivalent of `.md`-file custom commands — copy them to `~/.pi/agent/prompts/*.md` or `.pi/prompts/*.md` as-is, nothing to build or convert.

## One small config change

- **Existing skills directories**: Pi's `settings.json` supports a `skills` array that can point directly at an existing skills folder — you don't need to copy or duplicate skill files. Add the path once: `pi config` (or edit `settings.json` directly) → `skills: ["~/path/to/skills"]`.
- **Permission rules**: if you had customized allow/ask/deny settings for specific tools elsewhere, recreate them as `echo-permissions` rules: `/permissions allow|deny|ask <tool> [pattern]`. The five-mode enum (`manual`/`acceptEdits`/`plan`/`dontAsk`/`bypass`) is a common naming convention, so `/permissions mode <mode>` should map directly onto an equivalent mode switcher.
- **MCP servers**: `echo-mcp-bridge`'s config (`.pi/echo/mcp-servers.json`, `{servers: [{name, command, args?, env?}]}`) is similar in spirit to a typical `mcpServers` config but not byte-for-byte identical — copy each server entry over by hand (same fields, different wrapper shape).
- **Hooks**: `echo-hooks` uses a standalone `.pi/echo/hooks.json` file with a per-event `matcher`/`hooks`/`command` shape for the six events it supports (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`) — copy just those entries over (see the coverage table in `echo-hooks`' README for what the rest maps to, which is nothing).
- **Status line**: a typical `statusLine` setting maps to `echo-statusline`'s `.pi/echo/statusline.json` (`{command, timeout?}`) — same idea (one shell command, JSON on stdin, its stdout rendered), not a byte-identical stdin schema.

## Same command names, different mechanism underneath

- `/plan` — a familiar command name. `echo-plan-mode` additionally exposes a model-callable `exit_plan_mode` tool (not just a UI flow), closer to a real approval-gate than a plain toggle.
- `/output-style` — a familiar command name, but read the divergence carefully: `echo-output-styles` **appends** the style text to Pi's default system prompt rather than fully replacing it. If you wrote a style elsewhere that assumes it's the *entire* system prompt (including its own tool-usage instructions), it will behave differently here — written from scratch, `echo`'s built-in styles (`concise`/`explanatory`/`learning`) assume they're an overlay, not a replacement.

## No direct equivalent — start fresh, don't expect a migration

- **Checkpoints**: automatic per-prompt checkpoints from elsewhere have no imported history in `echo-checkpoints` — there's nothing to migrate, just start using `/rewind` going forward. Requires the project to actually be a git repository (see `echo-checkpoints`' README for what happens if it isn't).
- **Background tasks**: background bash elsewhere maps to `echo-tasks`' `run_task`/`task_status`/`kill_task` — no state to bring over, since a running process can't be migrated between tools anyway.
- **CI/headless usage**: `echo-ci` wraps `pi --mode json -p` the way you might have scripted around another tool's headless mode — see its own README for exit-code semantics, which are `echo`'s own convention.

## What's still genuinely different, not just relabeled

Pi's own hook/event surface covers session lifecycle, tool interception, and context rewriting, but has no equivalent for a lot of hook-style events other tools expose. `echo-hooks` maps six of the common ones (see above); a long tail of narrower events — permission prompts, sub-agent lifecycle, task/worktree events, compaction hooks, elicitation — have no Pi primitive to map onto. If your prior setup leaned on hooks in that gap, there is no `echo` package that closes it — this isn't an oversight to file a bug about, it's an honestly-scoped limitation of what Pi's extension API exposes today.
