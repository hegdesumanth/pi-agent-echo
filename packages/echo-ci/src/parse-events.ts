import { pushRawLine, type RunAccumulator } from "./types.ts";

/**
 * Parses one line of pi's `--mode json` NDJSON stream into the running
 * accumulator. Verified against the currently installed
 * `@earendil-works/pi-agent-core`'s real `AgentEvent` union (not the informal
 * subset Pi's own subagent example happens to touch) — `tool_execution_end`
 * carries `isError` directly and is the authoritative source for tool
 * failure detection, not string-sniffing message content. Malformed/non-JSON
 * lines (pi can print plain text before ever emitting a JSON event, e.g. a
 * "No API key found" message) don't crash parsing, but they are NOT silently
 * discarded either — an earlier version did exactly that and, found via live
 * testing against the real `pi` binary, it meant a plain-text startup failure
 * produced an empty-looking summary with zero explanation. They're kept in
 * `acc.rawLines` (bounded) so the CLI can surface them on failure.
 */
export function processLine(line: string, acc: RunAccumulator): void {
	const trimmed = line.trim();
	if (!trimmed) return;

	let event: any;
	try {
		event = JSON.parse(trimmed);
	} catch {
		// pi can print plain text before ever emitting a JSON event (e.g. "No API key found" on
		// startup failure) — keep it so a CI failure isn't reported with no explanation at all.
		pushRawLine(acc, trimmed);
		return;
	}

	if (event.type === "session") {
		acc.sessionId = event.id;
		acc.cwd = event.cwd;
		return;
	}

	if (event.type === "turn_start") {
		acc.turns += 1;
		return;
	}

	if (event.type === "tool_execution_end") {
		acc.toolCalls += 1;
		if (event.isError) {
			acc.toolErrors += 1;
			acc.toolErrorNames.push(event.toolName ?? "unknown");
		}
		return;
	}

	if (event.type === "message_end" && event.message?.role === "assistant") {
		const message = event.message;
		if (Array.isArray(message.content)) {
			const text = message.content
				.filter((part: any) => part?.type === "text" && typeof part.text === "string")
				.map((part: any) => part.text)
				.join("\n");
			if (text) acc.finalText = text;
		}
		if (typeof message.stopReason === "string") acc.stopReason = message.stopReason;
		if (typeof message.errorMessage === "string") acc.errorMessage = message.errorMessage;
	}
}
