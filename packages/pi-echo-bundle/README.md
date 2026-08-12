# pi-echo-bundle

Installs and registers all thirteen `echo` extensions in one shot: `pi install npm:pi-echo-bundle`. Each of the other thirteen packages remains independently installable on its own — this is purely additive, nothing about them changed to make this exist.

## Design note

Depends on all thirteen packages as real npm dependencies (so one `npm install` resolves the whole set — the same mechanism that resolves `pi-echo-core` for any single one of them today), then imports each package's default export and calls it with the same `pi` instance. This relies only on ordinary Node ancestor `node_modules` resolution, not any Pi-specific glob support.

**Verified before building, not assumed:** checked Pi's own source (`resolveExtensionEntries` in `core/package-manager.js`) for whether a package manifest could instead just point at its dependencies' folders via `"extensions"` glob patterns. It can't — manifest extension paths resolve via plain `path.resolve()`, not globs (despite the docs' prose implying otherwise for this resource type), and Pi's own auto-discovery explicitly skips `node_modules`. Importing each package's factory function directly, rather than trying to get Pi to discover them, is what actually works.

**The real trade-off, stated plainly:** Pi's loader treats whatever file it's given as one `Extension` — loading thirteen packages this way means Pi sees a single "pi-echo-bundle" extension, not thirteen independently identifiable ones. Each factory call is individually wrapped (try/caught and logged by name) so one package failing to register doesn't take the rest down and the failure is still identifiable by name — but any future per-extension enable/disable UI in Pi would still show one entry, not thirteen. Installing the packages individually doesn't have that limitation.

## Usage

```bash
pi install npm:pi-echo-bundle        # global
pi install npm:pi-echo-bundle -l     # project-local
```

Want only some of the thirteen? Install those specific packages instead (`pi install npm:pi-echo-permissions`, etc.) — this package is for "give me everything," not a replacement for picking individually.
