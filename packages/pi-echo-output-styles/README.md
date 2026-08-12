# pi-echo-output-styles

Command-driven persona/tone switching, using `before_agent_start`'s `systemPrompt` override.

## Design note

This package **appends** the active style's text to `ctx.getSystemPrompt()` rather than replacing it outright — a full replacement risks silently discarding the tool-usage guidance baked into Pi's default prompt, which this module has no way to reconstruct. Appending a persona/tone overlay is a smaller, safer claim than "alternate system prompt," and is what's actually built here.

## Usage

```
/output-style              # list available styles, active one marked
/output-style concise      # switch (persisted per-project in .pi/echo/output-style.json)
/output-style default      # reset to Pi's unmodified prompt
```

Ships three built-in styles (`styles/*.md` in this package): `concise`, `explanatory`, `learning`. Project-local styles go in `.pi/echo/styles/*.md` (nearest ancestor, same resolution `pi-echo-core` uses for permissions/state); a project-local file with the same name as a built-in overrides it.
