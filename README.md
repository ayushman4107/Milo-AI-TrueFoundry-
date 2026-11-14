# Milo AI

A VS Code coding agent built on TrueForge for the TrueFoundry Forge-a-thon at Techfest, IIT Bombay. It makes repository context visible and changes reviewable and reversible.

**Status:** an implemented VS Code MVP with tested editor, MCP and TrueForge integrations. Real Gemini trials exposed incomplete Task A docstrings and Task B failures; daily free quota blocked the remaining runs. The full submission is not yet validated.

## Working features

- Exemplar tracing across definitions, registrations, tests, docs and changelog, including multiline CLI decorator aliases.
- Four context fidelities under a serialized UTF-8 byte budget, with inclusion/pruning reasons and actual read provenance.
- Shadow edits, successive staged reads, selection restrictions, individual hunk review and conflict-aware undo.
- Authenticated localhost MCP, per-attempt cancellation fences, TrueForge SSE timeline and session links.
- Ordered model fallback for recognized provider failures, circuit cooldown and no replay after commit dispatch.
- Python AST validation without source execution or silent reindentation.
- Separate read-only Scout session with capability-limited MCP and evidence-bound handoff.
- Git-visible repository capture, binary fixtures and dirty buffers; path/symbol discovery beyond initial context.
- Import canaries, dependency fingerprints and base-versus-patch verification before acceptance or after apply.
- Python unresolved-name warnings, nearby conventions, enclosing-function selection and requirement evidence.
- Keyboard review, formatting-only collapse, safe stale-edit rebasing, activity, retry notes, setup doctor and small-model presets.
- Explicit journaled save with guarded startup recovery; approximate tokens and exportable evidence.

All model execution goes through TrueForge. The model never receives a direct editor-write capability. The runtime approval opens local review; exact hunk acceptance remains host-owned and one-use. Accepted edits apply to editor buffers. Saving remains a separate editor action.

## Validation

- 84 passing tests, including 1,000 seeded edit/review/undo cases; strict TypeScript and extension build pass.
- Five public-command scenarios pass on Windows and Remote WSL, including review cancellation, default-shortcut collision checks and host-owned hunk decisions.
- Nine checks in a real VS Code host: activation, two-file apply, Unicode/CRLF, unsaved disk preservation, stale rejection, undo, cancellation, path containment and workbench opening.
- Production Milo components tested against real TrueForge: separate Scout, forced provider 401, fallback, discovery, staging/rereading, context, same-turn approval, local review, apply and undo. Dropping the approval stream produces one review and no extra model turn. The provider is deliberately scripted.
- Live child-process cancellation, crash-recovery conflicts, import origins, binary copying, differential tests and review-script keyboard/message handling are covered.
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

Context budgets enforce bytes; token estimates remain approximate. Inventory covers Git-visible files plus dirty buffers, subject to explicit size/path exclusions. Ignored files and external dependencies' actual contents are outside coverage. Python version, pip inventory, lockfiles and captured bytes/modes contribute verification evidence.

Verification is a trusted command in a temporary copy, **not an OS sandbox**. Environment filtering, limits and ordinary process-tree cancellation do not confine hostile code or deliberately escaped descendants. Journaled saves support guarded recovery, not cross-file atomicity or defense against malicious local filesystem races. Conflicting disk edits and dirty buffers are preserved.

Name warnings and checklist evidence are advisory. Import reordering and variable renaming are not labeled harmless formatting. Retry uses fresh revisions and a steering note, not old write capabilities. Per-hunk chat is excluded from Round 1. Public commands pass in actual Windows and Remote WSL extension hosts. Complete real-model A/B/C demonstrations, the two-model repeated benchmark, broader disconnect coverage and physical-key/recording checks remain gates; see the evaluation for actual completed attempts and failures.

## Research and evidence

- [Provider, benchmark and keyboard implementation](docs/PROVIDER-AND-REHEARSAL.md)
- [Physical-key checklist](docs/KEYBOARD-REHEARSAL.md)
- [Eight-heading write-up draft](docs/SUBMISSION-DRAFT.md)

- [Accuracy/recovery research and implementation](docs/ACCURACY-AND-RECOVERY.md)
- [Real-model evaluation and rehearsal](docs/EVALUATION.md)
- [Observed Scout and reconnect fault test](docs/research/reconnect-contract-observed.json)
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
