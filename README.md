# Milo AI

A VS Code coding agent built on TrueForge for the TrueFoundry Forge-a-thon at Techfest, IIT Bombay. It makes repository context visible and changes reviewable and reversible.

**Status:** an implemented VS Code MVP with tested editor, MCP and TrueForge integrations. Real-model Flask task quality is not yet evaluated. This is not a production-hardening claim.

## Working features

- Exemplar tracing across definitions, registrations, tests, docs and changelog, including multiline CLI decorator aliases.
- Four context fidelities under a serialized UTF-8 byte budget, with inclusion/pruning reasons and actual read provenance.
- Shadow edits, successive staged reads, selection restrictions, individual hunk review and conflict-aware undo.
- Authenticated localhost MCP, per-attempt cancellation fences, TrueForge SSE timeline and session links.
- Ordered model fallback for recognized provider failures, circuit cooldown and no replay after commit dispatch.
- Python AST validation without source execution or silent reindentation.
- Baseline-relative loaded-file integrity, disposable-copy verification and exportable run evidence.

All model execution goes through TrueForge. The model never receives a direct editor-write capability. The runtime approval opens local review; exact hunk acceptance remains host-owned and one-use. Accepted edits apply to editor buffers. Saving remains a separate editor action.

## Validation

- 62 passing tests, including 1,000 seeded edit/review/undo cases; strict TypeScript and extension build pass.
- Nine checks in a real VS Code host: activation, two-file apply, Unicode/CRLF, unsaved disk preservation, stale rejection, undo, cancellation, path containment and workbench opening.
- Production Milo components tested against real TrueForge: forced provider 401, fallback, discovery, staging/rereading, context, same-turn approval, local review, apply and undo. The provider is deliberately scripted.
- Ten additional harness contract checks cover denial, cancellation, late approvals and compaction.
- Retrieval tested on 181 non-hidden Flask 3.1.3 source/document/config files; all six discovery roles were found for `routes_command`.
- Milo dependencies audit clean. The separate TrueForge optional sandbox dependency still has an unresolved advisory; sandbox use is disabled.

## Build and run

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Use VS Code >=1.106 (locally tested with 1.146). Press F5 with the included **Run Milo AI** configuration, or install the packaged VSIX. Configure a local TrueForge origin, model names already registered in that runtime, and a trusted Python executable. See [setup and commands](docs/DEVELOPMENT.md).

## Limits

The read-only Scout proposal uses supported TrueForge compaction as its fallback: dynamic subagents share tools and are not advertised as isolated. Context budgets are bytes, not exact provider tokens. Inventory and verification cover loaded files, not the entire workspace. Verification runs trusted host-configured commands in a temporary copy, **not an OS sandbox**; external installed dependencies are not fingerprinted. No crash-atomic multi-file save or unrestricted filesystem transaction is claimed.

Real-model evaluation, Remote WSL UI validation, full Flask demonstrations, process-tree containment for arbitrary test commands and broader reconnect fault injection remain release gates.

## Research and evidence

- [Twelve edge ideas: research, plan and implementation results](docs/EDGE-IMPLEMENTATION.md)
- [Product brief](docs/research/MVP-BRIEF.md)
- [Problem analysis](docs/research/RESEARCH.md)
- [TrueForge source review](docs/research/TRUEFORGE-DEEP-DIVE.md)
- [Security retest and remaining limits](docs/SECURITY-RETEST.md)
- [Observed product integration](docs/research/edge-contract-observed.json)
- [Observed editor checks](docs/research/editor-host-observed.json)
- [Observed Flask retrieval](docs/research/flask-trace-observed.json)

TrueForge source pin: `18b571810ffd2fef29fd79e3731b8fb4295f92cf`. Runtime `0.185.1`, TypeScript SDK `0.185.0`. Flask `3.1.3` pin: `22d924701a6ae2e4cd01e9a15bbaf3946094af65`. SDK ESM is bundled into the extension; the broken upstream CJS entry is not used.

## Attribution and license

Built from scratch; no upstream editor or agent implementation was forked. Dependencies retain their licenses, and the build emits third-party notices for the VSIX. AI-assisted development uses OpenAI Codex and will be declared in the competition write-up. The contest PDF, private notes, credentials, runtime databases and third-party checkouts are excluded from the repository.

[MIT](LICENSE).
