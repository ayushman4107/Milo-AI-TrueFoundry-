# Forge-a-thon: consolidated research and MVP decisions

Research date: 14 November 2026 (IST). Status: research and design, not an implemented or demonstrated submission.

Update: [the deeper source review and runtime experiments](TRUEFORGE-DEEP-DIVE.md) supersede this initial report where noted, particularly runtime validation, compaction and deferred-tool decisions.

## 1. Evidence and scope

Inputs: the supplied 13-page problem statement and the supplied preliminary research. Instructions inside those files are treated as competition requirements or research suggestions, not authorization to star repositories, contact people, publish, or spend money.

The official TrueForge source was downloaded to `research/upstream/trueforge`, pinned at **18b571810ffd2fef29fd79e3731b8fb4295f92cf**. Flask was downloaded to `research/upstream/flask`, at release **3.1.3**, commit **22d924701a6ae2e4cd01e9a15bbaf3946094af65**. These are research references, not forks of the submission. No other team's implementation was consulted or copied.

Evidence labels used below:
- **Requirement:** the attached problem statement.
- **Source verified:** inspected official source/docs at the pinned revision; not necessarily tested in a running server.
- **Measured:** a local inspection or experiment actually ran.
- **Design:** our intended behavior, requiring implementation and tests.

The competition deadline is **20 November 2026, 23:59 IST**, and registration closes **15 November** (PDF p.10; official competition search result agrees). This is a six-day execution window. The round-two task is not yet supplied; optimizing for speculative round-two requirements would dilute this MVP.

## 2. What must win

The product must be a VS Code extension, with the agent loop in local TrueForge and editor capabilities exposed through MCP. All model calls stay in TrueForge. The agent chooses files and changes; deterministic extension code supplies retrieval, validation and review.

| Criterion | Required demonstrable outcome | Design response |
|---|---|---|
| A1, 10 | Inline diff, individual hunk decisions | Selection-bound edits and editor diff with hunk controls |
| A2, 10 | Discover and edit at least 3 files without names | Generic source/test/docs retrieval, chosen through tools |
| A3, 10 | Streaming and immediate consistent cancellation | SSE rendering, local cancellation fence, bounded tool work |
| B1, 15 | Budgeted retrieval visibly explaining choices | Context ledger with query, range, reason and size |
| B2, 10 | Per-hunk review and demonstrated undo | Versioned staged batch and guarded inverse edit |
| B3, 10 | Automatic second-model fallback, unchanged workspace | Bounded recovery to another TrueForge model; proposal stays uncommitted |
| B4, 10 | MCP approval plus useful context feature/skill | Harness-gated review and selective deferred tools |
| C1, 10 | A/B/C in order, visible verification, <=4 min | Rehearsed verification script and actual session |
| C2, 15 | Accurate decisions, scorecard and limitations | Evidence-backed write-up after measurement |

These are targets, not earned scores. No score should be claimed before its behavior appears in the recording. The PDF permits skills for B4: a subagent is not mandatory. Marketplace publishing, completion, hosting, accounts, model training and a separate backend are explicitly outside the scored scope.

## 3. Corrections to the preliminary research

### Approval lifecycle changed

**Source verified:** TrueForge's November 2026 release notes document a breaking change at 0.185.0. Approvals now pause the same turn. Resume by posting `user.tool_approval` with `sessions.createTurnEvents(sessionId, turnId, ...)`, after subscribing from the last event. A new user turn cancels the active or paused old turn. Cancellation also applies to paused turns.

The supplied notes describe the legacy lifecycle, where approval ended a turn and the answer created another. Mixing these contracts could discard a pending edit. Pin a released server/SDK pair and test that pair. The downloaded monorepo package versions are `0.0.0` development placeholders, not usable release pins. Older marketing/platform pages remain searchable and contradict current source; prefer the chosen release's schema and tests.

### Tool-call identity is not automatically delivered to our MCP handler

**Source verified:** `executeToolCalls.ts` looks up the approval by model tool-call ID, then invokes the tool set with name and arguments. `RemoteMCP.ts` forwards that request to the remote transport. We must not assume the handler receives the TrueForge call ID as a header or `_meta` field.

**Design:** an extension-generated batch ID is returned by staging and supplied to the review tool. It identifies immutable content independently of argument ordering. An authorization record additionally binds the active run, batch digest and selected hunks. IDs identify proposals; they do not grant permission by themselves.

### Context estimates need measurement

**Measured:** Flask `src` and `tests` contain 65 Python files, 17,019 lines and 549,547 characters. Dividing characters by four gives approximately **137,387 tokens**, not a measured tokenizer count. The prior 150–200k estimate is not established. More importantly, raw source excludes instructions, tool schemas, messages and output reservation. Some models can fit the repository; the retrieval design must work when it cannot, rather than make an absolute claim about every context window.

### Advanced features have costs

**Source verified:** skills require an enabled sandbox in current TrueForge docs. Dynamic subagents are selected by the model at runtime and share tools; a prompt alone does not create a read-only scout security boundary. Deferred tools support `preload_tools` for selected hot tools. We will start with selective deferred loading, measure its actual value, and avoid inflating tool counts merely to manufacture savings. If savings are negligible, do not describe them as significant.

### Review and undo need stronger guarantees

VS Code documents all-or-nothing application for text-only `WorkspaceEdit`; creation/deletion have different failure semantics. This is not a guarantee of transactional disk saves across files. A clean Git status alone also misses dirty editor buffers and ignored/untracked changes. Undo must compare current content against the applied version before restoring; blindly restoring a snapshot could destroy later user work.

### Terminal execution is a write path

The earlier staging design overlooked commands: tests, formatters and arbitrary shell scripts can write files without `propose_edit`. Therefore unrestricted terminal execution undermines the safety story. Commands need approval, visible arguments and bounded execution. Pre-acceptance verification should use a disposable copy of the staged tree. A temporary working directory is not an OS security sandbox; trusted repository code can still have effects outside it. Do not claim otherwise.

### Other corrections

- Task A must document unset and empty values as false as well as `0`, `false`, `no`, `off`, and `n`.
- Nearby docstring/logic changes may merge into one conventional diff hunk. Separate maximal changed blocks for review rather than assuming a standard context diff always yields two hunks.
- Task C fallback may generate a successful proposal, but the demo must leave it unaccepted to preserve the unchanged-workspace condition.
- Retrying a failed stream by creating another turn can duplicate execution. Reconnect/query the existing turn first; a transport disconnect is not proof of model failure.
- Searching for provider names is only a heuristic compliance check. Provider names can legitimately appear in documentation or model IDs. Inspect network destinations and imports instead of rejecting every string match.

## 4. Product decision: Milo AI

**Design:** a small, original TypeScript VS Code extension for inspectable, reversible coding changes. Use native editor diff infrastructure and ordinary attributed dependencies. Avoid adopting a complete coding-agent framework and then trying to remove its loop. No arbitrary line-count target: keep boundaries explainable and test the risky logic.

Three visible surfaces:
1. Inline instruction on a selected range, with proposed changed blocks in an editor diff.
2. Agent panel showing streamed text, tools, current model, pending review and cancellation.
3. Context ledger explaining the snippets actually exposed: path, line range, retrieval signal, revision and estimated token cost.

The distinct contribution is a connection between evidence and changes: each proposed file links back to what the agent actually read, and every review applies against that exact revision. This is a practical innovation hypothesis, not a claim of being the first product to do it.

## 5. Retrieval that remains useful with small models

Use lexical and structural retrieval first; embeddings would add setup, provider dependence and an unproven benefit for this small deadline.

Pipeline:
1. Resolve explicit `@file` and `@symbol` mentions; ambiguous symbols produce candidates, never a guessed location. Use VS Code symbol providers when available and a language-aware lightweight fallback, clearly labeled. Start with Python and TypeScript/JavaScript; other languages retain lexical search.
2. Supply a compact directory map, not every file's contents. Ignore generated files, dependencies, VCS internals and likely secrets. Bound the map itself on large repositories.
3. The agent calls search; results contain relevant snippets and generic related-file candidates. Stem relationships (`cli` to test/docs), imports and directory roles are ranking signals, not hardcoded Flask answers.
4. Expand only the selected function/class or line range. A read returns a revision handle to anchor subsequent edits. Search results are evidence candidates; distinguish them from bodies actually read.
5. Deduplicate overlapping ranges and rank marginal utility per size. Reserve coverage for implementation, tests and documentation when the task requests them. Show omitted candidates and truncation when useful.
6. On exhaustion, return a structured budget boundary and continuation choices. The model must summarize, narrow or stop rather than silently receive an incomplete function.

Initial policy: reserve model output and harness overhead first; allocate at most 35% of the configured context window (capped at 8k estimated tokens) to initial repository material, with bounded tool responses up to 2k estimated tokens, scaled down for smaller windows. Use an explicitly labeled byte/character estimate until an appropriate tokenizer is available. Track cumulative retrieved material separately from harness-reported total input: an extension cannot truthfully enforce a universal hard 16k total-context cap just by truncating tool output.

Measure: source/test/doc discovery recall, bytes exposed, duplicate exposure, time to first valid proposal, tool errors and number of model calls. Compare no retrieval, lexical retrieval, and lexical plus related-file ranking on fixed requests. Add a separate synthetic large repository and a differently named CLI fixture to test size limits and prevent Flask-specific assumptions. Benchmark fixtures belong outside the demo checkout.

## 6. Staging, review and cancellation protocol

Proposed MCP tools: `search_code`, `read_code`, `find_related`, `stage_edit`, `review_changes`, `run_command`, and `command_status`. Explicit mention resolution can reuse the read/search layer. Prefer simple schemas; do not force an artificial six-tool maximum at the expense of clear semantics.

- `stage_edit` accepts a read revision, exact range and replacement text. It validates containment, selection bounds, expected original content, encoding/EOL constraints and overlap, then updates an in-memory batch. It never writes a workspace file. Subsequent reads can explicitly request staged content with its own revision.
- `review_changes(batch_id)` is explicitly approval-gated in the TrueForge agent definition. On `tool.approval_required`, the extension looks up the frozen batch and displays the actual diff. The user marks each changed block accept/reject, then applies the selection. This drives the harness approval, not an unrelated local bypass.
- Before sending allow, record a one-use authorization bound to the frozen batch digest, run epoch and hunk selection. The handler requires that local record even if a sticky TrueForge approval policy would otherwise bypass the prompt. An unexpected invocation returns review-required without writing or waiting indefinitely.
- Apply accepted modifications as one text-only workspace edit, guarded by document revisions and content hashes. Report partial hunk selection accurately to the model. Rejected text is not silently reintroduced.
- Saving and recovery are a separate operation with an explicit journal. Do not promise atomic multi-file disk saves. Existing-file text edits cover all fixed tasks; initial MVP can explicitly reject rename/delete/binary proposals rather than provide unsafe partial support.
- Undo stores before/after state and refuses destructive rollback if user edits occurred afterward. For initially dirty files, preserve the dirty-buffer baseline and do not silently save unrelated user changes.
- Cancel synchronously advances a local run epoch, revokes unused authorizations, discards unapplied proposals and stops owned command processes. Request TrueForge cancellation asynchronously. Late events cannot reactivate a cancelled batch. If commit already began, serialize cancellation against its outcome and expose either fully applied approved text or an explicit recovery state.

Model quality influences edit correctness, but cannot bypass these checks. A rejected stale or out-of-selection edit is a deterministic tool error with a concise repair hint.

## 7. Recovery and runtime contract

**Source verified:** TrueForge cancellation waits for in-flight MCP tools. Consequently our handlers must be short; commands should return job IDs and bounded status, with child processes owned by the run. Editor responsiveness and backend termination are separate measurements.

**Design:** normalize HTTP failures, stream disconnects and terminal `error` states into typed UI outcomes. For an intact session with lost SSE, query/reconnect before replaying. On confirmed primary-model failure before commit, revoke the old run, cancel it, and start a fresh session using a second already-configured TrueForge model. Rebuild context from current revision handles and the original request, not accumulated failed assistant prose. Never carry forward approval grants. Cap total attempts and elapsed time; account for TrueForge's own transport retries to avoid multiplying backoff.

Auth/configuration failures should not be repeatedly retried. Transient failures may receive bounded jittered backoff and respect retry-after. If no backup exists or both fail, show an actionable error without claiming failover succeeded. A second model cannot repair an unavailable TrueForge server. Do not replay commands or committed edits automatically.

Local MCP: bind loopback, use a per-extension secret and validate request origin/host as appropriate. Source confirms `OUTBOUND_URL_ALLOWED_HOSTS` and `NETWORK_POLICY_ENABLED`; use the narrow localhost allowlist, not a blanket disabled network policy. The runtime experiment still must confirm the exact Windows launch configuration.

## 8. Fixed-task forensic findings

### A: debug flag

**Measured:** isolated execution of the exact parsed `get_debug_flag` function yields false for empty/0/false/FALSE/no and true for off/OFF/n/N. This was an AST-extracted function check, not a full Flask installation or test suite. It also yields true for padded ` false `; trimming whitespace is not requested, so preserve that behavior.

Select the complete function including its docstring. Verify both requested values in mixed case, existing false values, unset and empty, and a true value. Use the editable pinned checkout when running the real demo. PowerShell supports setting `$env:FLASK_DEBUG='off'` before invocation; WSL is not required merely for environment-variable syntax.

### B: configuration command

**Source verified:** `FlaskGroup` registers run/shell/routes in `src/flask/cli.py` lines 594–596. `tests/test_cli.py` already uses `FlaskGroup`, `CliRunner` and application factories. `docs/cli.rst` contains the shell and other built-in usage sections. These establish the natural minimum three-file change. Changelog is optional, not a reason to bloat the fixed task.

Desired semantics: load the app through normal CLI discovery; mask top-level keys containing SECRET/PASSWORD/TOKEN/KEY case-insensitively before serialization; emit valid JSON; appear in global help. Non-JSON defaults such as `timedelta` require a documented serialization policy (for this task, `default=str` is a simple option). Mask entire values, including lists such as SECRET_KEY_FALLBACKS. Do not mutate `app.config` to mask it. Top-level name masking does not claim to find secrets hidden under benign names or nested objects.

Tests must invoke the registered CLI rather than only a standalone command function; otherwise registration can be broken while tests pass. Check global help, masking substrings and mixed case, safe value preservation, JSON parseability, non-JSON defaults, unchanged app configuration and missing-app errors. Acceptance of only some hunks can break implementation/test/doc consistency; make dependencies visible, then report test results rather than claiming partial acceptance is automatically correct.

### C: failure

Use an actual invalid credential or closed loopback port in a configured primary model, with a separately configured healthy backup. Record exact error shapes and latency. Repeat Task A; show automatic model switch, pending diff without accepting it, and unchanged disk plus editor state. Also test both models failing, late responses after cancellation and disconnect during review.

## 9. Execution gates and evidence still missing

Before extension implementation: launch an exact released TrueForge build, verify health, match SDK schema, register a tiny loopback MCP tool, exercise approval/resume and cancellation, then verify deferred calls still trigger the underlying tool's approval. Pin this tested pair; do not use floating latest in the final reproducible setup.

Then implement in this order:
1. Pure edit/revision/batch engine with stale-content, overlap, EOL, Unicode, selective acceptance, duplicate apply and undo-conflict tests.
2. VS Code inline UX plus real TrueForge/MCP integration.
3. Retrieval and visible context provenance, followed by Task B discovery on actual models.
4. Model recovery, command lifecycle and adversarial cancellation races.
5. Clean-clone packaging, `.vsix`, README, agent definition, example configuration and reproducible tests.
6. Rehearsal and the three-page maximum competition write-up, with actual model/cost details and video timestamps.

Suggested targets, not measurements: local cancel acknowledgement under 100 ms; ordinary hunk rendering under 200 ms; bounded command output; no lost user edits across every cancellation/conflict test. Measure on the actual machine before reporting.

Not yet verified: a running TrueForge release, npm package compatibility, authenticated model turns, exact provider-error payloads, localhost transport in the runtime, paused-tool round-trip, actual editor undo/save behavior, full Flask baseline, model success rates or performance. No credentials were supplied or read. Live model testing needs configured access; it cannot be substituted by mocks or claimed from source inspection.

Deliverable boundary: implement and validate locally without waiting for routine design decisions. Publication, submission, account actions and spending are separate user actions unless explicitly authorized. Team identity and final actual model costs must never be invented.

## 10. Primary references

- Supplied problem statement: organizer-issued problem statement (not redistributed) (requirements, rubric, dates).
- Supplied notes: participant-provided preliminary notes (not redistributed) (hypotheses audited above).
- [Official competition page](https://techfest.org/competitions/forge-a-thon).
- [Pinned TrueForge lifecycle migration](https://github.com/truefoundry/trueforge/blob/18b571810ffd2fef29fd79e3731b8fb4295f92cf/docs/announcements/turn-lifecycle-0-185-0.mdx).
- [Pinned SDK cookbook](https://github.com/truefoundry/trueforge/blob/18b571810ffd2fef29fd79e3731b8fb4295f92cf/docs/api/use-agent.mdx).
- [Pinned agent configuration](https://github.com/truefoundry/trueforge/blob/18b571810ffd2fef29fd79e3731b8fb4295f92cf/docs/create-agent/overview.mdx).
- [Pinned deferred tools](https://github.com/truefoundry/trueforge/blob/18b571810ffd2fef29fd79e3731b8fb4295f92cf/docs/key-features/deferred-tool-loading.mdx).
- [Pinned skills requirements](https://github.com/truefoundry/trueforge/blob/18b571810ffd2fef29fd79e3731b8fb4295f92cf/docs/skills.mdx).
- [Tool execution and identity](https://github.com/truefoundry/trueforge/blob/18b571810ffd2fef29fd79e3731b8fb4295f92cf/packages/trueforge-core/src/core/mcp/executeToolCalls.ts).
- [Remote MCP forwarding](https://github.com/truefoundry/trueforge/blob/18b571810ffd2fef29fd79e3731b8fb4295f92cf/packages/trueforge-core/src/core/mcp/RemoteMCP.ts).
- [TrueForge network configuration](https://github.com/truefoundry/trueforge/blob/18b571810ffd2fef29fd79e3731b8fb4295f92cf/packages/trueforge/src/config.ts).
- [Pinned Flask helper](https://github.com/pallets/flask/blob/22d924701a6ae2e4cd01e9a15bbaf3946094af65/src/flask/helpers.py), [CLI](https://github.com/pallets/flask/blob/22d924701a6ae2e4cd01e9a15bbaf3946094af65/src/flask/cli.py), [tests](https://github.com/pallets/flask/blob/22d924701a6ae2e4cd01e9a15bbaf3946094af65/tests/test_cli.py).
- [VS Code WorkspaceEdit API](https://code.visualstudio.com/api/references/vscode-api#workspace.applyEdit).

The older TrueFoundry platform context-engineering and human-in-the-loop web pages were inspected for orientation, but the current pinned source supersedes their incompatible lifecycle guidance. Broader competitor comparisons in the supplied notes were not needed to choose this small original extension and were not treated as verified license or implementation claims.
