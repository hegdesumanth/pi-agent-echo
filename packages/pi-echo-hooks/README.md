# pi-echo-hooks

A no-code, JSON-configured hooks system: declare a shell command per lifecycle event in a config file, no TypeScript required. This is different from what "hooks" means in Pi itself, where a hook is a `pi.on(...)` call inside an extension you write.

## Design note

Only `PreToolUse` supports blocking: exit code `2` blocks the tool call and its stderr becomes the block reason. `PostToolUse`/`UserPromptSubmit`/`SessionStart`/`SessionEnd`/`Stop` are fire-and-forget: the command runs, a non-zero exit surfaces as a warning notification, nothing is blocked or transformed. This is a deliberate, honestly-scoped simplification — blocking or rewriting the prompt on submit is a sharper edge (mutating user input) left for later if actually needed, not built speculatively here.

Hook commands are spawned directly (not via `pi.exec()`, which has no way to pipe stdin) so the event payload can be written to the command's stdin as JSON. Hooks from both project and global scope run together (additive) rather than one overriding the other — deliberately different from `pi-echo-permissions`' first-match-wins rules, since the two config shapes mean different things (rules pick one outcome; hooks are notifications/gates that can legitimately come from more than one source at once).

**Live-verified, not just type-checked:** ran `pi -e ./packages/pi-echo-hooks` with a `SessionStart` hook configured against a small stdin-reading script — confirmed the hook actually fired and received the exact expected JSON payload (`hook_event_name`, `session_id`, `cwd`) on stdin. (While investigating an apparent hang during this test, also confirmed — via a corrected baseline with properly-captured exit codes — that a ~11-15s delay between a successful turn completing and the `pi` process actually exiting is native `pi`/provider-connection teardown behavior, present even with zero extensions loaded, not something `pi-echo-hooks` or any `echo` package causes. Noted in `pi-echo-ci`'s README since it's relevant to CI `--timeout` budgets.)

## Coverage table — read this before assuming full lifecycle coverage

Six hook events are mapped here, onto the Pi native events that actually exist for them:

| Hook event | Pi event used | Blocking? |
|---|---|---|
| `PreToolUse` | `tool_call` | Yes (exit code 2) |
| `PostToolUse` | `tool_result` | No |
| `UserPromptSubmit` | `input` | No |
| `SessionStart` | `session_start` | No |
| `SessionEnd` | `session_shutdown` | No |
| `Stop` | `agent_end` | No |

**Not supported — no Pi primitive exists to map onto:** `Setup`, `InstructionsLoaded`, `UserPromptExpansion`, `PermissionRequest`, `PermissionDenied`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `MessageDisplay`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `StopFailure`, `TeammateIdle`, `ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`, `PreCompact`, `PostCompact`, `Elicitation`, `ElicitationResult`. If your workflow depends on one of these, there is no `echo` package that closes that gap today.

## Usage

Configure hooks in `.pi/echo/hooks.json` (project) and/or `~/.pi/agent/echo/hooks.json` (global):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "hooks": [{ "type": "command", "command": "./scripts/check-command.sh" }]
      }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "notify-send 'pi finished'" }] }
    ]
  }
}
```

`matcher` (optional, `PreToolUse`/`PostToolUse` only) is a regex tested against the tool name; omit it to match every tool. Each hook command receives a JSON payload on stdin (`hook_event_name`, `session_id`, `cwd`, plus event-specific fields like `tool_name`/`tool_input`) and has `timeout` ms (default 30000) to respond.
