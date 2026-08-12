# pi-echo-plan-mode

Read-only exploration mode with a model-callable approval gate, adapted from Pi's own official `plan-mode` example.

## Design note

`pi-echo-plan-mode` uses `pi.setActiveTools()`/`pi.getActiveTools()` as its primary mechanism, `pi.on("before_agent_start")` for system-prompt injection, `pi.on("context")` only for stale-message filtering, and `pi.appendEntry`/`ctx.sessionManager.getEntries()` for session-resume reconstruction — all lifted near-verbatim from Pi's official example. The one real change: the on/off flag lives in `pi-echo-core`'s shared `state.json` `mode` field instead of a private closure boolean, so `/plan` flips the same mode `pi-echo-permissions` enforces. It deliberately does not implement its own permission-enforcement layer (that's `pi-echo-permissions`' job, via the shared mode flag) and does not attempt a fully general "plan quality" check — `extractTodoItems`'s regex-based "Plan:" parser is a heuristic fallback for models that describe a plan without calling `exit_plan_mode`, not a guarantee of a coherent plan.

## Composition with pi-echo-permissions

`setActiveTools()` is the primary enforcement (the model never even sees `edit`/`write` as callable while plan mode is on — cheapest, best UX). `pi-echo-permissions`' plan-mode branch in `evaluate()` is a deliberate backup, not redundant: it covers cases the tool-swap can't (a call already in flight when `/plan` is invoked mid-turn, an unknown custom/MCP tool this package has no reason to know about, or a state-sync bug). Neither package imports the other — `pi-echo-core`'s `state.json` is the entire integration contract.

## Usage

```
/plan            # toggle plan mode
/todos           # show the current plan's todo list
Ctrl+Alt+P       # toggle plan mode (shortcut)
```

While in plan mode, the model has access to `read`/`bash`/`grep`/`find`/`ls`/`exit_plan_mode` only; bash is further restricted to a read-only allowlist. The model is instructed to write a numbered `Plan:` section and then call `exit_plan_mode` with the full plan text to request approval — approving flips the shared mode back to whatever it was **before** plan mode was entered (see below) and restores full tool access. If the model describes a plan in prose without calling the tool, an `agent_end` fallback (matching the official example) offers to execute/refine/stay via a `ctx.ui.select` prompt.

## A real bug found on review, fixed

Exiting plan mode used to always set the mode back to `"manual"`, unconditionally. If a project's normal working mode was `acceptEdits` or `dontAsk`, toggling `/plan` on and back off silently demoted it to `manual` every time — a real, if minor, loss of the user's own configuration, not just plan mode's business to override. Fixed by capturing the mode that was active immediately before entering plan mode (`previousMode`, persisted alongside the todo list so it survives a session resume) and restoring exactly that on exit instead of hardcoding `manual`.
