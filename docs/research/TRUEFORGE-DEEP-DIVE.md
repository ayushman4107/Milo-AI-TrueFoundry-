# TrueForge deep dive: measured contracts and Milo AI decisions

14 November 2026. This updates the initial research report. It distinguishes real harness experiments from planned product behavior.

## Repository coverage

Inspected the official repository at `18b571810ffd2fef29fd79e3731b8fb4295f92cf`, focusing on the paths that determine our product's correctness:

| Area | Inspected implementation / tests | Consequence for Milo |
|---|---|---|
| Session/turn persistence | `agent-session/TurnHandle.ts`, `turnResume.test.ts`, `turnStream.test.ts`, server `apis/turns.ts` | Active/paused lifecycle, disconnects, durable events and cancellation are separate concerns |
| Approvals | `mcp/ToolSet.ts`, `executeToolCalls.ts`, `orchestrationApproval.test.ts` | Explicit per-call decisions coexist with sticky policies; local exact-patch authorization remains necessary |
| MCP transport | `RemoteMCP.ts`, `remoteMcpClient.ts`, MCP schemas/routes | Tool-call identity is not automatically forwarded; loopback reachability must be tested |
| Deferred loading | `runtime/DeferredTool.ts`, `deferredLoading.test.ts` | Four discovery tools add overhead; approval applies to the underlying deferred call |
| Context | `ContextCompaction.ts`, `LargeToolResponse.ts`, capabilities configuration | Compaction works without sandbox; oversized output can be blocked without being saved |
| Model failures/retries | `ssrfGuard.ts`, model provider schemas, SDK client | Provider error, local transport error and harness outage need different recovery |
| UI streaming | SDK `events.ts`, assistant UI `turnStreamUpdate.ts` and tests | Message deltas share IDs; naive deduplication/reconnect loses or duplicates text |
| Distribution/setup | README, CLI/config, manifests, published npm packages | Real ESM/CJS and OS behavior must be checked, not inferred from export declarations |

This is a targeted architectural review, not a claim to have read every file or executed upstream's entire test suite. No implementation from another competition team was used. No TrueForge source was copied into Milo.

## Runtime experiments

Published runtime **0.185.1**, SDK **0.185.0**, MCP SDK **1.32.2**. Real TrueForge HTTP server, SQLite, model routing, SSE and remote MCP were exercised. The model endpoint was a scripted local test fixture; no real model quality or task completion is inferred.

| Experiment | Observed outcome |
|---|---|
| Import published SDK as ESM | Passed |
| Import published SDK as CJS | Failed: `MODULE_NOT_FOUND`, `./api/index.js` |
| Start native Windows TrueForge | Blocked by Windows Application Control on `better-sqlite3` native module; also failed outside execution sandbox |
| Start in existing Debian WSL | Passed, localhost health reports 0.185.1 |
| Direct gated MCP call | Handler remains unexecuted until allow; same turn resumes to done |
| Deferred gated MCP call | Same approval behavior, underlying handler executes once after allow |
| Denied MCP call | Turn completes without executing handler |
| Cancel paused approval | Terminal cancelled, handler not executed; 19 ms in this local run |
| Scripted provider 401 | Terminal `turn.done` with status `error`; 62 ms in this local run |
| Cancel active provider stream | Terminal cancelled; 17 ms in this local run |
| Compaction, sandbox disabled | Both compaction start/finish events observed; turn completed |
| Windows client -> WSL server | Health request passed outside the execution sandbox |
| WSL server -> Windows localhost MCP | Failed with ECONNREFUSED; localhost belongs to different network environments |

The timing numbers are individual research observations, not performance guarantees. The test does not yet cover cancellation during a slow MCP handler, crash recovery, a real invalid paid-provider key, real LLM task success or the full VS Code adapter. The synthetic 401 has no real credential in it.

Reproduce with `scripts/runtime-contract.mjs`; the sanitized observed report is in `runtime-contract-observed.json`. The probe creates unique temporary model/MCP configurations, cancels its sessions and removes those configurations. Session histories remain in the disposable research database. Never point this probe at a shared or production server.

## Five findings that change the architecture

### 1. Streaming IDs are not chunk IDs

The SDK merges deltas into a base model message with the **same ID**. The server exposes event-based reconnect cursors; current streams do not use the legacy sequence-number resume interface. Official UI code replays from the model-message shell while a message is incomplete, taking earlier open messages into account. A client that drops all duplicate IDs will drop most streaming content. A client that appends replayed deltas to the old partial buffer will duplicate text.

**Decision:** build a message reducer with explicit replay boundaries, reset the replayed partial message, and rebuild from the shell. Reconnect the existing turn before considering a retry. Add lost-connection tests with interleaved messages before claiming resilient streaming. Approval resume after a durable paused event is a different, tested case.

### 2. Compaction cannot be our source of truth

The current implementation defaults to an 80% context threshold (or 50k when unknown), with output-reservation handling. It makes a non-streaming model call and replaces working context with a summary and continuation instruction. This differs from older platform prose describing an 85% trigger and preserved recent messages/full sandbox transcript. Our inspected compactor does not establish those stronger guarantees.

**Decision:** exact file revisions, accepted/rejected hunk decisions and verification results live in the extension's ledger. Compaction can lose an explanation; it cannot grant permission or change a patch. Expose a bounded `task_state`/read capability so the model can recover the active request, remaining obligations and evidence handles after compaction. Never restore authorization from a model-generated summary.

### 3. Deferred loading has a break-even point

In the controlled one-tool experiment, preloading exposed two tool schemas including the built-in datetime tool. Deferring exposed five, because four meta tools replaced the individual tool. That is a schema-count observation, not a tokenizer benchmark, but enough to reject “deferred is always cheaper.”

**Decision:** preloaded compact tools for inline work. For agent mode, compare eager vs selective preload using actual serialized tool schemas and model round trips. Use compaction as a proven sandbox-free context capability when accumulated context warrants it; selective deferral remains available if measured beneficial. We will not bloat the tool catalog to manufacture a context-engineering claim. The final demo must show whichever feature actually contributes.

### 4. Verification results belong to a patch, not a chat

Tests against a full proposal can pass, then the user rejects an implementation hunk while retaining a test hunk. A persistent green badge would now misrepresent a different patch. Tests can also write caches and other files, bypassing the edit tool if run in the working checkout.

**Design innovation:** verification records bind to a digest of the complete staged tree, command, environment and result. Change a hunk decision or base revision and the record becomes stale. Run pre-apply checks against a disposable copy; show baseline failures separately from regressions. This is a correctness mechanism, not a claim that temporary directories sandbox arbitrary code. Commands still require trust/approval and owned-process cancellation.

### 5. A successful model fallback does not authorize edits

For Task C, a healthy backup may produce a valid edit. The criterion still expects an unchanged workspace. Therefore recovery should reach a proposed diff without applying it. Failed-run approval grants must not survive the switch. A malformed model proposal should receive a repairable MCP validation error; this must not become a second agent loop inside the extension.

**Decision:** bounded recovery only for confirmed model failures before commit; isolate run epochs and recreate the TrueForge session on the backup model. Transport failures first try same-turn reconnection. Already committed edits and commands are not replayed. Actual fallback behavior remains to be implemented and tested with two configured models.

## Product innovations selected for this deadline

| Feature | User-visible benefit | Minimum validation |
|---|---|---|
| Evidence-backed edits | Open the exact snippet on which a change is based | Unknown or stale evidence cannot authorize a write |
| Coverage-aware retrieval | Implementation/test/docs candidates with reasons | Works on differently named fixtures, not only Flask paths |
| Review-bound verification | Test result is valid for the accepted patch | Rejecting a hunk invalidates the earlier result |
| Safe partial acceptance | Individual changed blocks remain selectable | Rejected content remains byte-for-byte unchanged |
| Cancellation fence | Late tool calls cannot revive cancelled changes | Race tests around approval and commit boundaries |
| Compaction recovery ledger | Small models can recover exact task state | Rehydration preserves IDs/revisions without trusting summaries |

These are scoped design decisions, not unsubstantiated claims of market novelty. For six days, omit semantic vector databases, multi-agent orchestration dashboards, autonomous refactor engines, cloud services and arbitrary file operations. Existing text-file edits cover the fixed tasks. Additional complexity must earn its place through a measurable improvement.

## First implemented foundation

`src/core/change-batch.ts` implements a filesystem-independent proposal state machine. Read evidence covers a specific text range; proposals require matching original text; selection limits remain enforced even when the model reads more broadly. Frozen batches cannot be mutated. Accepted changes become a one-use commit plan after all relevant current files match their base. Cancellation revokes unused authorization. Undo refuses to overwrite later edits.

`src/core/hunks.ts` uses the ordinary BSD-licensed `diff` dependency to create separate changed blocks. Display context does not merge nearby docstring and logic changes into one mandatory choice. Size and complexity limits bound the synchronous operation; a worker remains preferable for the eventual editor adapter.

**13 tests pass**, including CRLF, Unicode boundaries, stale multi-file plans, selected/rejected changes, cancellation, frozen review, overlap, missing evidence and conflicting undo. Type checking passes. These tests verify the core only: `consume()` issuing a plan is not a workspace commit. The VS Code adapter must still enforce document versions atomically, serialize commit/cancel, handle dirty buffers and journal disk-save failures. Filesystem containment and symlink checks also belong in that adapter, not in this string-based core.

## Setup decision for the development machine

Use VS Code Remote WSL with the extension host, MCP tools and TrueForge on the Linux side, or use a native OS where the runtime can load normally. The current Windows/WSL split is not a supported full round trip. Do not solve it by disabling Windows Application Control or globally disabling TrueForge's outbound protections. No security policy was changed during these experiments.

The research runtime used a workspace-local official Node 22.16.0 binary, checked against Node's published SHA-256 list. Runtime archives, node_modules and databases are excluded from Git. Normal users should use their own supported Node installation, not reproduce this machine-specific bootstrap.

## Next implementation gates

1. Build the editor adapter, inline command, virtual diff and per-hunk controls around the tested core.
2. Add the MCP boundary and stream reducer; reproduce the contract tests with the actual Milo server.
3. Add budgeted retrieval and context ledger, then run Task B with no named files.
4. Add revision-bound verification, backup-model recovery and failure/race tests.
5. Run all three fixed tasks on real configured models; package a VSIX and test setup from a clean clone.
6. Prepare the <=4 minute recording and accurate 1–3 page write-up. Use measured behavior and actual costs, not target scores.

The remaining work includes the full editor UI, filesystem integration, retrieval, verification runner, actual model fallback and real-model evaluation. This checkpoint is deliberately described as a tested foundation, not a finished MVP.

## Primary source entry points

- [TrueForge pinned source tree](https://github.com/truefoundry/trueforge/tree/18b571810ffd2fef29fd79e3731b8fb4295f92cf)
- [Compaction implementation](https://github.com/truefoundry/trueforge/blob/18b571810ffd2fef29fd79e3731b8fb4295f92cf/packages/trueforge-core/src/core/capabilities/builtins/ContextCompaction.ts)
- [Streaming cursor behavior](https://github.com/truefoundry/trueforge/blob/18b571810ffd2fef29fd79e3731b8fb4295f92cf/packages/assistant-ui-runtime/src/turnStreamUpdate.ts)
- [Approval orchestration tests](https://github.com/truefoundry/trueforge/blob/18b571810ffd2fef29fd79e3731b8fb4295f92cf/packages/trueforge-core/tests/orchestration/orchestrationApproval.test.ts)
- [Deferred-tool tests](https://github.com/truefoundry/trueforge/blob/18b571810ffd2fef29fd79e3731b8fb4295f92cf/packages/trueforge-core/tests/core/runtime/deferredLoading.test.ts)
- [Published runtime](https://www.npmjs.com/package/@truefoundry/trueforge/v/0.185.1) and [SDK](https://www.npmjs.com/package/@truefoundry/trueforge-sdk/v/0.185.0)
