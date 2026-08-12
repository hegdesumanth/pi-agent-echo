# pi-echo-todos

A general-purpose, model-callable todo list — independent of `pi-echo-plan-mode`'s own todo tracking (which only exists during plan-mode execution).

## Design note

Uses `pi.registerTool()` for the whole-list-replace `todo_write` tool and `ctx.ui.setWidget()`/`ctx.ui.setStatus()` for persistent rendering — both plain Pi primitives, nothing new invented. State is session-scoped, persisted via `pi.appendEntry()` and restored on `session_start`, the same pattern `pi-echo-plan-mode` uses. Deliberately does not hard-block on "more than one `in_progress` item" — surfaced as a note in the tool result, not a rejected call.

## Usage

The model calls `todo_write({todos: [...]})` with the full list every time (not a diff); an empty array clears it. `/todo` shows the current list on demand; the widget stays visible above the editor as long as the list is non-empty.
