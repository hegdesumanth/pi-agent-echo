/**
 * pi-echo-mcp-bridge
 *
 * Connects to configured MCP (Model Context Protocol) servers over stdio and
 * registers each of their tools as a regular Pi tool
 * (`mcp__<server>__<tool>`), using the official `@modelcontextprotocol/sdk`
 * directly rather than an unreviewed third-party bridge package — a
 * deliberate choice, given that any Pi package (and any dependency it pulls
 * in) runs with full system access.
 *
 * Design note / composition with pi-echo-permissions: because every bridged
 * tool is registered via the ordinary `pi.registerTool()`, and Pi's
 * `tool_call` event fires for every tool call regardless of who registered
 * it (`CustomToolCallEvent.toolName: string` covers any name), a bridged
 * MCP tool is ALREADY subject to `pi-echo-permissions`' generic gate with zero
 * extra wrapping — this was verified against the installed package's type
 * declarations, not assumed. What is NOT covered: `pi-echo-core`'s
 * protected-path check only extracts a path from the native `write`/`edit`
 * tools' `path` field and does a substring scan of `bash`'s `command` — it
 * has no way to know that some `mcp__filesystem__write_file` tool's
 * `arguments.path` field is a filesystem write. An MCP server capable of
 * writing files is gated only by whatever rule matches its tool name (e.g.
 * `{tool: "mcp__filesystem__write_file", decision: "ask"}`), not by the
 * protected-paths list. See SECURITY.md.
 *
 * Also sets a persistent `⚡ N/M mcp` footer status (color reflecting
 * all/some/none connected) once the initial connection phase completes, so
 * connection health is visible without running `/mcp` — the command remains
 * for the per-server detail the status line doesn't have room for.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findProjectEchoDir, globalEchoDir } from "pi-echo-core";
import { Type } from "typebox";

const CONNECT_TIMEOUT_MS = 10_000;
const STATUS_KEY = "echo-mcp";

interface McpServerConfig {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

interface McpServersFile {
	servers?: McpServerConfig[];
}

interface ServerStatus {
	name: string;
	status: "connected" | "failed";
	toolCount: number;
	error?: string;
}

function configFilePath(dir: string): string {
	return path.join(dir, "mcp-servers.json");
}

function readConfigFile(filePath: string): McpServerConfig[] {
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as McpServersFile;
		return parsed.servers ?? [];
	} catch {
		return [];
	}
}

function discoverServerConfigs(cwd: string): McpServerConfig[] {
	const merged = new Map<string, McpServerConfig>();
	for (const s of readConfigFile(configFilePath(globalEchoDir()))) merged.set(s.name, s);
	for (const s of readConfigFile(configFilePath(findProjectEchoDir(cwd)))) merged.set(s.name, s); // project wins
	return [...merged.values()];
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

function mapMcpContent(content: unknown): { type: "text"; text: string } | { type: "image"; data: string; mimeType: string } {
	const item = content as { type?: string; text?: string; data?: string; mimeType?: string };
	if (item?.type === "text" && typeof item.text === "string") {
		return { type: "text", text: item.text };
	}
	if (item?.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
		return { type: "image", data: item.data, mimeType: item.mimeType };
	}
	return { type: "text", text: JSON.stringify(item) };
}

/**
 * Set once after the initial connection phase completes at session_start —
 * MCP connections don't change mid-session the way git branch or test
 * results do, so (unlike pi-echo-git-status/pi-echo-test-status) there's no
 * turn_end refresh here; nothing would have changed for it to pick up.
 */
function renderStatus(ctx: ExtensionContext, statuses: ServerStatus[]): void {
	if (statuses.length === 0) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const connected = statuses.filter((s) => s.status === "connected").length;
	const color = connected === 0 ? "error" : connected === statuses.length ? "success" : "warning";
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(color, `⚡ ${connected}/${statuses.length} mcp`));
}

async function connectServer(
	config: McpServerConfig,
): Promise<{ client: Client; transport: StdioClientTransport; toolCount: number } | { error: string }> {
	const transport = new StdioClientTransport({
		command: config.command,
		args: config.args,
		env: config.env,
	});
	const client = new Client({ name: `pi-echo-mcp-bridge/${config.name}`, version: "0.1.0" });

	try {
		await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `Connecting to MCP server "${config.name}"`);
		const { tools } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `Listing tools for "${config.name}"`);
		return { client, transport, toolCount: tools.length };
	} catch (err) {
		try {
			await transport.close();
		} catch {
			/* already dead */
		}
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

export default function (pi: ExtensionAPI): void {
	const statuses: ServerStatus[] = [];
	let activeConnections: { client: Client; transport: StdioClientTransport }[] = [];

	async function closeAllConnections(): Promise<void> {
		await Promise.all(
			activeConnections.map(async ({ client }) => {
				try {
					await client.close();
				} catch {
					/* already dead */
				}
			}),
		);
		activeConnections = [];
	}

	// session_start can fire more than once per process (reload/resume/fork) — without this,
	// every reconnect would leak the previous run's child processes and open pipes, and (as
	// found during manual testing) a lingering connection is exactly what keeps a `pi -p`
	// one-shot invocation from exiting cleanly even after it has finished its work.
	pi.on("session_shutdown", async () => {
		await closeAllConnections();
	});

	pi.on("session_start", async (_event, ctx) => {
		await closeAllConnections();
		statuses.length = 0;
		const configs = discoverServerConfigs(ctx.cwd);

		for (const config of configs) {
			const result = await connectServer(config);

			if ("error" in result) {
				statuses.push({ name: config.name, status: "failed", toolCount: 0, error: result.error });
				if (ctx.hasUI) {
					ctx.ui.notify(`pi-echo-mcp-bridge: failed to connect to "${config.name}": ${result.error}`, "warning");
				}
				continue;
			}

			const { client, transport, toolCount } = result;
			activeConnections.push({ client, transport });
			statuses.push({ name: config.name, status: "connected", toolCount });

			const { tools } = await client.listTools();
			for (const tool of tools) {
				pi.registerTool({
					name: `mcp__${config.name}__${tool.name}`,
					label: `${config.name}: ${tool.title ?? tool.name}`,
					description: `[MCP server: ${config.name}] ${tool.description ?? tool.name}`,
					parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema as never),
					async execute(_toolCallId, params) {
						const result = await client.callTool({ name: tool.name, arguments: params });
						if ("content" in result && Array.isArray(result.content)) {
							return {
								content: result.content.map(mapMcpContent),
								details: undefined,
								isError: "isError" in result ? Boolean(result.isError) : undefined,
							};
						}
						return { content: [{ type: "text", text: JSON.stringify(result) }], details: undefined };
					},
				});
			}
		}

		renderStatus(ctx, statuses);
	});

	pi.registerCommand("mcp", {
		description: "Show configured MCP servers and their connection status",
		handler: async (_args, ctx) => {
			if (statuses.length === 0) {
				ctx.ui.notify(
					`No MCP servers configured. Add one to ${configFilePath(findProjectEchoDir(ctx.cwd))} (project) or ${configFilePath(globalEchoDir())} (global):\n{"servers": [{"name": "example", "command": "npx", "args": ["-y", "some-mcp-server"]}]}`,
					"info",
				);
				return;
			}
			const lines = statuses.map((s) =>
				s.status === "connected"
					? `✓ ${s.name}: connected, ${s.toolCount} tool(s)`
					: `✗ ${s.name}: failed — ${s.error}`,
			);
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
