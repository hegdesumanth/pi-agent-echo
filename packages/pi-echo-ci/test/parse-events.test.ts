import assert from "node:assert/strict";
import { test } from "node:test";
import { processLine } from "../src/parse-events.ts";
import { createAccumulator } from "../src/types.ts";

test("non-JSON lines don't crash parsing and don't count as turns/tool calls", () => {
	const acc = createAccumulator();
	processLine("No API key found for the selected model.", acc);
	processLine("", acc);
	processLine("   ", acc);
	assert.equal(acc.turns, 0);
	assert.equal(acc.toolCalls, 0);
});

test("keeps non-JSON lines in rawLines so a plain-text failure isn't silently swallowed", () => {
	const acc = createAccumulator();
	processLine("No API key found for the selected model.", acc);
	processLine("", acc); // blank lines are not pushed
	assert.deepEqual(acc.rawLines, ["No API key found for the selected model."]);
});

test("rawLines is bounded to the most recent entries", () => {
	const acc = createAccumulator();
	for (let i = 0; i < 25; i++) processLine(`line ${i}`, acc);
	assert.equal(acc.rawLines.length, 20);
	assert.equal(acc.rawLines[0], "line 5");
	assert.equal(acc.rawLines[19], "line 24");
});

test("captures session id and cwd from the session header", () => {
	const acc = createAccumulator();
	processLine(JSON.stringify({ type: "session", version: 3, id: "abc-123", cwd: "/repo" }), acc);
	assert.equal(acc.sessionId, "abc-123");
	assert.equal(acc.cwd, "/repo");
});

test("counts turn_start events", () => {
	const acc = createAccumulator();
	processLine(JSON.stringify({ type: "turn_start" }), acc);
	processLine(JSON.stringify({ type: "turn_start" }), acc);
	assert.equal(acc.turns, 2);
});

test("counts tool_execution_end events and tracks errors by tool name", () => {
	const acc = createAccumulator();
	processLine(JSON.stringify({ type: "tool_execution_end", toolName: "bash", isError: false, result: "ok" }), acc);
	processLine(JSON.stringify({ type: "tool_execution_end", toolName: "write", isError: true, result: "denied" }), acc);
	assert.equal(acc.toolCalls, 2);
	assert.equal(acc.toolErrors, 1);
	assert.deepEqual(acc.toolErrorNames, ["write"]);
});

test("extracts final assistant text, stopReason, and errorMessage from message_end", () => {
	const acc = createAccumulator();
	processLine(
		JSON.stringify({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Done." }],
				stopReason: "end",
			},
		}),
		acc,
	);
	assert.equal(acc.finalText, "Done.");
	assert.equal(acc.stopReason, "end");
});

test("ignores message_end for non-assistant roles", () => {
	const acc = createAccumulator();
	processLine(JSON.stringify({ type: "message_end", message: { role: "user", content: "hi" } }), acc);
	assert.equal(acc.finalText, undefined);
});

test("later message_end overwrites earlier finalText (keeps the latest assistant turn)", () => {
	const acc = createAccumulator();
	processLine(
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "first" }] } }),
		acc,
	);
	processLine(
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "second" }] } }),
		acc,
	);
	assert.equal(acc.finalText, "second");
});
