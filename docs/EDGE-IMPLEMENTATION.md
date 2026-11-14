# Edge ideas: research and implementation plan

Historical 0.2.0 checkpoint. For current Scout isolation, full-tree verification, recovery, UI and reconnect results, see [0.3.0 accuracy and recovery](ACCURACY-AND-RECOVERY.md). Older limitations below are retained as development history, not current product claims.

14 November 2026. The supplied notes are proposals, not evidence of implemented behavior or earned rubric scores.

| Idea | Research decision | Implementation and acceptance gate |
|---|---|---|
| Exemplar trace | Literal identifiers and decorator aliases are useful retrieval signals, not proof every hit must change | Generic source/test/docs/registration candidates; renamed fixtures and pinned Flask checks |
| Four fidelity context | A character heuristic cannot guarantee provider tokens | Pack serialized entries under a hard byte budget; expose the distinction and pruned candidates |
| Provenance | Host-generated discovery IDs must identify exact file revisions | Register immutable discoveries; reads resolve those IDs and reject invented IDs |
| Scout | Current TrueForge dynamic children share tools; no verified per-child read-only boundary | Use verified compaction fallback; do not advertise an isolated Scout |
| Commit gate | Current approvals pause/resume the same turn | Existing batch/coordinator plus future MCP submit gate; never auto-apply at turn end |
| Timeline | Deltas share message IDs; replay must replace a shell before appending | Use SDK merge behavior and explicit replay boundaries; UI remains a separate gate |
| Shadow overlay | Subsequent reads must see staged versions; base revisions still govern commit | Revision-checked overlay; freezing blocks further writes; no disk mutation |
| Integrity chip | Git alone misses buffers/untracked/ignored changes | Compare supplied disk and buffer inventories; report coverage, never claim universal cleanliness |
| Model failover | A disconnect is not confirmed provider failure; side effects must not replay | Injected harness driver, typed failures, bounded attempts, cancellation checks and circuit cooldown |
| Syntax/scope | Python ast parses without executing code; byte offsets differ from UTF-16 | Python-only bounded subprocess validation; do not silently reindent semantic Python blocks |
| Helpful errors | Keep validation deterministic; explanations don't grant permission | Existing validation errors; typed repair guidance at the future MCP boundary |
| Verify/undo | Result must refer to exact patch and environment | Existing receipt/undo core; real command runner and editor integration still required |

Build order: retrieval/provenance -> overlay/integrity -> failover policy -> syntax/scope -> editor/MCP composition -> real models and fixed tasks. Each stage requires adverse-input tests. Do not publish a finished-MVP claim until the last two gates pass.

Sources checked: [VS Code virtual documents](https://code.visualstudio.com/api/extension-guides/virtual-documents), [WorkspaceEdit API](https://code.visualstudio.com/api/references/vscode-api#workspace.applyEdit), [Python AST](https://docs.python.org/3/library/ast.html), official TrueForge source at `18b571810ffd2fef29fd79e3731b8fb4295f92cf` (`docs/key-features/subagents.mdx`, `docs/api/use-agent.mdx`, `packages/assistant-ui-runtime/src/turnStreamUpdate.ts`). Existing live-harness contract results validate compaction and approval, not the future UI.

## Implemented results, 14 November 2026

The plan above has now been built into `src/extension.ts`, the editor adapter, MCP bridge and production TrueForge driver. References to a future UI/bridge in the original plan describe its starting point.

| Idea | Delivered behavior |
|---|---|
| Exemplar trace | Six roles, multiline CLI decorator aliases, per-file/per-role caps. Renamed fixtures and actual Flask retrieval pass. The original five-line alias window missed Flask and was fixed. |
| Context packing | Four fidelities, reasons, pruning and serialized byte accounting. Level 2 is an observed excerpt; skeleton extraction is heuristic. Tests exercise every level and Unicode overhead. |
| Provenance | Host-issued discovery IDs bind exact paths/revisions. Reads and context exposures appear in the workbench; invented or stale IDs fail. |
| Scout | Production configuration enables the verified compaction fallback. No isolated read-only child agent is claimed. |
| Commit gate | Same-turn runtime approval opens local review; exact hunk selection grants one-use host authorization. No sticky approval policy or model-accessible write grant. |
| Timeline | SDK delta merging, shared IDs, bounded full-turn replay, session links, escaped script-free webview. Broad disconnect fault injection remains a release gate. |
| Shadow edits | Successive revision-bound staged reads, frozen review, real text-only WorkspaceEdit apply and conflict-aware undo. Saving is separate; crash-atomic disk writes are not claimed. |
| Integrity | Loaded-path disk/buffer fingerprints compared to the actual baseline; partial coverage is explicit. Preexisting dirt is not reported as clean. |
| Failover | Production TrueForge driver, recognized terminal provider errors, ordered fallback, circuit cooldown and per-attempt revocation. Forced 401-to-success workflow passes. Unknown errors/disconnects do not blindly replay a model turn. |
| Syntax/scope | Python AST parsing without source execution/dedenting, selection enforcement, CRLF/BOM checks. Missing Python blocks review. Accepted subsets are parsed again before apply. |
| Helpful errors | Strict MCP schemas and actionable tool errors. Repair does not restore cancelled/frozen write permissions. |
| Verify/undo | Real trusted-command runner in a disposable loaded-file copy, parent-process/output limits, patch-bound receipts and stale-result invalidation. Not an OS sandbox; external dependencies and detached descendants are not contained. |

An additional evidence-export command opens JSON with discovery/read records, accepted before/after hashes, a session link and receipt ID. It includes local excerpts and should be reviewed before sharing. No scores are invented from intended features or model prose.

Validation: **62 tests**, strict types/build, **nine native VS Code host checks**, production-component TrueForge workflow, and actual Flask retrieval. Reports: [editor](research/editor-host-observed.json), [harness](research/edge-contract-observed.json), [Flask](research/flask-trace-observed.json). Harness providers are scripted; real-model quality and the three full Flask demonstrations remain unmeasured.

Final concurrency review added two fences: reject overlays changed during asynchronous Python validation, and abort an old attempt before fallback replaces its bridge. Commit dispatch is marked as the side-effect boundary before asynchronous editor I/O, preventing replay of an uncertain write.

Additional primary sources: [MCP server documentation](https://ts.sdk.modelcontextprotocol.io/server), [VS Code version capture](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostBulkEdits.ts), [VSIX packaging](https://code.visualstudio.com/api/working-with-extensions/publishing-extension). Pinned TrueForge `core/errors.ts` plus the live probe establish the narrowly recognized terminal model-error format. Assistant/tool prose is never used as the failover classification source.
