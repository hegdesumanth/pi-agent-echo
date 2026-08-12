# pi-echo-themes

The `echo-signal` theme pair (dark/light) plus a matching welcome header.

**Visual preview:** see `../../docs/echo-signal-preview.png` (also shown in the root `README.md`) — a mocked real session showing both variants with actual theme tokens applied (not an approximation), plus the welcome-header mockup.

## Design note

The teal "signal" accent and the rest of the palette are a deliberate design, not a random pick — see the preview link for the reasoning (high-contrast tool-state boxes, diff colors that don't clash with syntax highlighting, a light variant that's actually redesigned for a light background rather than a naive inversion of the dark one). The one standout idea: the six required `thinking*` border tokens (`thinkingOff` → `thinkingXhigh`, plus optional `thinkingMax`) are treated as a real gradient — cool and quiet at `off`, warming steadily, landing hot at `max` — so Pi's reasoning-effort level reads from the editor border color alone.

The welcome header (`ctx.ui.setHeader()`, same primitive as Pi's own official `custom-header.ts` example) deliberately does **not** hardcode `echo-signal`'s hex values — it uses `theme.fg()` with the seven thinking-level tokens and the `accent` token, which every Pi theme defines. That means the header looks coherent regardless of which theme is actually active, not just when `echo-signal` is selected. Its status line lists real, currently-registered `echo-*` slash commands (via `pi.getCommands()`) rather than a package count — some `echo` packages (like `pi-echo-hooks`) register no tools or commands at all, so a package count isn't reliably computable from Pi's extension API; a command list is the honest equivalent, not a downgrade.

## Usage

```
pi install ./packages/pi-echo-themes -l
/settings          # select "echo-signal-dark" or "echo-signal-light"
/builtin-header    # restore Pi's default header if you'd rather keep the theme without the custom welcome screen
```
