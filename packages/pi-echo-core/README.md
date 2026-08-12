# pi-echo-core

Shared types, the pure permission-decision function, and policy/state file I/O used by `pi-echo-permissions` and `pi-echo-plan-mode`. Not a Pi extension itself — it registers no tools, commands, or event handlers, and is not independently `pi install`-able.

## Design note

`pi-echo-core` uses no Pi extension primitive at all, by design — it is plain TypeScript plus two filesystem helpers imported from `@earendil-works/pi-coding-agent` (`getAgentDir()`, `CONFIG_DIR_NAME`) and one concurrency helper (`withFileMutationQueue`), and deliberately registers zero extensions, tools, or commands of its own. It does not try to be a general-purpose, schema-validated config system — it is scoped exactly to the two files described below, and a package that needs different shared state should add a new file/type here rather than overload these two.

## API

- `evaluate(toolName, input, policy, state) -> {decision, reason?}` — pure, no I/O. See `src/evaluate.ts` for the six-step decision order (protected paths first, always; then bypass; then plan; then acceptEdits; then dontAsk; then manual/default rule evaluation).
- `readPermissions(cwd)` / `writePermissions(cwd, scope, permissions)` — `permissions.json` at global (`~/.pi/agent/echo/`) and project (nearest ancestor `.pi/echo/`, or `<cwd>/.pi/echo/` if none exists yet) scope. Reads merge project rules before global rules and union both scopes' `protectedPaths`.
- `readState(cwd)` / `writeState(cwd, scope, state)` — `state.json`, `{mode, lastModeChangeEntryId?}`. Project state wins outright over global (not merged — mode is a single scalar).

## Testing

`npm test` builds then runs `node --test` against the compiled output in `dist/test/` — no live `pi` session required. Global-scope I/O tests set `PI_CODING_AGENT_DIR` to a temp directory so they never touch a real `~/.pi/agent`.
