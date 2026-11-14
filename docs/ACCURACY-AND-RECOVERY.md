# Accuracy and recovery: plan and results

The two supplied notes are design proposals, not proof that a limitation is solved. This iteration prioritizes the following work and acceptance gates.

1. Capture Git-tracked and non-ignored untracked files, including binary fixtures and dirty buffers, separately from the bounded model context. Fingerprint the captured tree and report exclusions. Verify temporary-copy Python import origins before trusting tests; record interpreter, pip inventory and lockfile hashes.
2. Bound trusted command execution and terminate the process group on POSIX or process tree on Windows. Test a live child process, cancellation, timeouts and output overflow. This is hardening, not a security sandbox.
3. Add base-versus-patch verification: keep changed tests in both copies, restore production files only in the base copy, require the same canary and command. A base failure is evidence only when paired with a patched pass; it does not automatically prove the intended assertion failed.
4. Add durable, journaled explicit save and conflict-aware activation recovery. Preserve user changes and uncertain outcomes; do not blindly roll back every incomplete journal. Keep editor-buffer apply separate from disk save.
5. Expose Scout through a separate TrueForge session and a server-enforced read-only capability. Verify forbidden tools cannot be invoked using its credentials. Handoff is agent-authored data, not host-chosen edits.
6. Fault-inject SSE disconnects during a real harness turn. Rebuild from persisted events without replaying completed approvals or creating a second turn. The current API uses event IDs/message shells, not a simple sequence-number cursor.
7. Add Python scope/name diagnostics, enclosing function selection and nearby conventions. Name uncertainty is a warning, not a blanket rejection: dynamic imports, star imports and runtime attributes cannot be resolved statically.
8. Add generic requirement evidence, conservative style-noise labels, ordered keyboard review, activity indicators, context-preserving retry and setup diagnostics. Checklist evidence must not be mislabeled behavioral verification.
9. Add explicitly approximate token estimates and small-model presets. Input usage includes hidden harness overhead; do not falsely calibrate a context-only byte count against total prompt tokens.
10. Prepare actual-model evaluation and Flask rehearsal records. Run them only against configured working models; no scores or repeated-run success claims from scripted providers. Per-hunk chat remains optional, as recommended in the supplied notes, until core correctness gates pass.

Primary references: [Node process groups](https://nodejs.org/api/child_process.html#optionsdetached), [Windows taskkill](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill), [Git file enumeration](https://git-scm.com/docs/git-ls-files), [Python symbol tables](https://docs.python.org/3/library/symtable.html), [Python AST offsets](https://docs.python.org/3/library/ast.html). TrueForge source remains pinned as documented in the deep dive; replay/approval behavior must be measured against the installed version.

## Implemented in 0.3.0

| Proposal | Behavior and boundary |
| --- | --- |
| Scout | Separate session/credential, no write or review tools, actual-read-bound work order. Patch agent chooses its own reads/edits. |
| Repository awareness | Git-visible catalog and cached regex symbols beyond initial model context. Binary fixtures and dirty buffers captured; exclusions visible. |
| Verification | Temp src first, import canary, Python/pip fingerprint, captured lockfile bytes/modes. External dependency contents not hashed. |
| Differential tests | Available before acceptance in review and after apply. Changed tests run on base and patch; inspect failure output. |
| Process hardening | Environment allowlist, no shell, limits, POSIX group and Windows tree kill. Ordinary child cancellation tested; escaped processes not contained. |
| Save recovery | Explicit journal, fsynced snapshots, per-file rename and committed marker. Startup waits for guarded recovery; conflicting edits/dirty buffers preserved. |
| Symbols/conventions | AST/symtable warnings, nearest names, enclosing selection, nearby docstrings/parameters. Dynamic attributes and imported third-party symbol existence unproven. Analysis exposure logged separately, granting no edit rights. |
| Stability | Same Python AST and significant tokens required for formatting-only. Comments, strings, import reordering and renames not dismissed. Whole-file classification can miss harmless hunks in mixed changes. |
| Checklist | Generic test/docs/help evidence and one repair nudge. No inference that tests pass or help works. |
| Review/steering | Role ordering, j/k/a/r/u, noise rejection, activity, retry note, exact-anchor stale rebase with local confirmation. Retry starts fresh revisions, preserving the visible context card. |
| Setup/models | Doctor, small-model preset, byte budgets, approximate token estimates with compatible output-usage calibration only. MCP outbound policy unknown until a successful call. |
| Reconnect | Actual runtime proxy drops approval SSE; persisted event replay avoids duplicate review/turn. Historical approved pauses are skipped. |

## Evidence and remaining gates

76 regression tests, strict TypeScript/build and nine native editor checks pass locally. New coverage includes live child cancellation, interrupted two-file save, conflicting user edits, binary copying, external import rejection, differential regression tests and review-script keyboard/message handling with escaped hostile-looking text.

The [real-harness fault report](research/reconnect-contract-observed.json) records one review, two turns (failed primary and healthy fallback), two subscriptions and a separate Scout session. Providers are scripted. Fault injection exposed a replay/pause deadlock; tracking already-approved call IDs and skipping historical pauses corrected it.

Real-model evaluation is blocked by missing configured providers. The runner and [rehearsal protocol](EVALUATION.md) are ready; no A/B/C success rate or video result is fabricated. Native keyboard interaction and full Remote WSL UI remain unverified. Per-hunk chat is deferred as recommended in the supplied notes. Exact tokenization, OS sandboxing, adversarial filesystem-race defense and cross-file atomicity remain limits.
