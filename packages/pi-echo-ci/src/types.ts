const MAX_RAW_LINES = 20;

export interface RunSummary {
	sessionId?: string;
	cwd?: string;
	turns: number;
	toolCalls: number;
	toolErrors: number;
	toolErrorNames: string[];
	finalText?: string;
	stopReason?: string;
	errorMessage?: string;
	/** Non-JSON stdout lines pi printed (e.g. plain-text errors like "No API key found") — bounded to the last MAX_RAW_LINES. */
	rawLines: string[];
}

export interface RunAccumulator {
	sessionId?: string;
	cwd?: string;
	turns: number;
	toolCalls: number;
	toolErrors: number;
	toolErrorNames: string[];
	finalText?: string;
	stopReason?: string;
	errorMessage?: string;
	rawLines: string[];
}

export function createAccumulator(): RunAccumulator {
	return { turns: 0, toolCalls: 0, toolErrors: 0, toolErrorNames: [], rawLines: [] };
}

export function pushRawLine(acc: RunAccumulator, line: string): void {
	acc.rawLines.push(line);
	if (acc.rawLines.length > MAX_RAW_LINES) acc.rawLines.shift();
}

export function toSummary(acc: RunAccumulator): RunSummary {
	return { ...acc };
}
