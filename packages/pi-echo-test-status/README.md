# pi-echo-test-status

A footer badge reflecting pass/fail from the last test/build bash command (`✓ test` / `✗ build`).

## Design note

Uses the bash tool's own `isError` field on the `tool_result` event as the pass/fail source, not output text-sniffing. Verified against the installed package's actual `bash.js` rather than assumed: the bash tool throws when the exit code is non-zero (instead of manually setting `isError` itself), and Pi's generic tool-execution wrapper converts that thrown error into `isError: true` upstream — so by the time this extension sees the event, `isError` already accurately reflects the real exit code, the same authoritative source `pi-echo-ci` uses for `tool_execution_end`.

Command matching is a pattern list covering npm/yarn/pnpm, cargo, go, pytest, mvn, make, and gradle — necessarily incomplete for anything not on that list, stated plainly rather than implying full coverage. Each pattern carries its own `test`/`build` label rather than re-deriving it from the command text separately — **found via testing**, not assumed correct: a word-boundary re-derivation mislabeled `pytest -v` as "check" instead of "test", since "test" isn't its own word inside "pytest". Pairing the label with the pattern that matched avoids that whole class of bug.

## Usage

No configuration — install it and the badge appears in the footer after the next matching test/build command runs.
