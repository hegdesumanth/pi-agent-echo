# pi-echo-mcp-bridge

Connects to configured MCP (Model Context Protocol) servers over stdio and registers each of their tools as a regular Pi tool.

## Design note

Built directly on the official `@modelcontextprotocol/sdk`, not an unreviewed third-party bridge package — a deliberate choice, since any Pi package (and any dependency it pulls in) runs with full system access.

**Composition with `pi-echo-permissions` is automatic, not something this package builds.** Every bridged tool is registered via the ordinary `pi.registerTool()`, and Pi's `tool_call` event fires for every tool call regardless of who registered it — verified against the installed package's type declarations (`CustomToolCallEvent.toolName: string` covers any name), not assumed. What is genuinely NOT covered: `pi-echo-core`'s protected-path check only extracts a path from the native `write`/`edit` tools' `path` field and scans `bash`'s `command` string — it has no way to know that some `mcp__filesystem__write_file` tool's `arguments.path` is a filesystem write. An MCP server capable of writing files is gated only by whatever rule matches its tool name, not by the protected-paths list. Add an explicit rule (e.g. `/permissions ask mcp__filesystem__write_file`) for any such tool. See `SECURITY.md`.

**A real bug found and fixed during manual testing, not just type-checked:** the initial version connected to MCP servers on `session_start` but never closed those connections. Verified live against a real MCP test server: `pi -e ./packages/pi-echo-mcp-bridge --mode json -p "..."` printed its output correctly but then **hung indefinitely** instead of exiting — the lingering child-process pipes from the open MCP connection kept Node's event loop alive. Fixed by tracking active connections and closing them both on `session_shutdown` and before reconnecting on any subsequent `session_start` (which can fire more than once per process, e.g. on `/reload` — without closing first, each reload would leak the previous run's connections and spawned processes).

## Usage

Configure servers in `.pi/echo/mcp-servers.json` (project scope) and/or `~/.pi/agent/echo/mcp-servers.json` (global scope; project entries with the same `name` override global ones):

```json
{
  "servers": [
    { "name": "example", "command": "npx", "args": ["-y", "some-mcp-server"], "env": {} }
  ]
}
```

Each server's tools are registered as `mcp__<server>__<tool>`. `/mcp` shows connection status and tool counts. A server that fails to connect (10s timeout) is skipped with a warning — it does not block the others or crash startup.

A persistent footer status (`⚡ N/M mcp`, color reflecting all/some/none connected) also appears once the initial connection phase completes, so connection health is visible at a glance without running `/mcp` — set once at `session_start`, not refreshed per-turn, since MCP connections don't change mid-session the way `pi-echo-git-status`/`pi-echo-test-status`'s indicators do.
