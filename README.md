# Milo AI

A VS Code coding agent built on TrueForge, designed to make repository context visible and code changes reviewable and reversible.

Built for the TrueFoundry Forge-a-thon at Techfest, IIT Bombay.

**Status:** tested safety core and real-harness contract probes. This repository does not yet contain a complete installable extension. Working behavior, experiments and unresolved limitations are tracked explicitly; planned features are not claimed as implemented.

## Product

- Selection-bound inline edits with individual hunk decisions.
- Agent-driven discovery across implementation, tests and documentation.
- A context ledger showing the code actually exposed, its provenance and budget.
- Staged changes with revision checks, conflict-aware undo and cancellation fencing.
- Automatic recovery through a second configured TrueForge model.
- Planned verification in a disposable copy, with results tied to the reviewed patch.

All model execution belongs to TrueForge. The extension will expose editor capabilities through MCP and will not call model providers directly.

## Research

- [Product brief](docs/research/MVP-BRIEF.md)
- [Consolidated problem analysis and architecture](docs/research/RESEARCH.md)
- [Deeper source review, measured contracts and design updates](docs/research/TRUEFORGE-DEEP-DIVE.md)
- [Development and reproducible validation](docs/DEVELOPMENT.md)
- [Adversarial retest, fixes and remaining release gates](docs/SECURITY-RETEST.md)

## Implemented and verified

- Immutable read evidence, selection/range checks and staged proposal batches.
- Individual changed blocks, one-use review decisions and guarded undo plans.
- One-use host commit tickets, async cancellation fencing and conservative recovery inspection.
- Patch-bound verification receipts that become stale after patch, input, command or environment changes.
- 41 passing tests (including 1,000 seeded edit/review/undo cases) and strict TypeScript checks.
- Ten passing contract checks against real TrueForge with a scripted localhost provider, including late approvals and cancellation during an MCP call.

Milo's dependencies audit clean. The separate TrueForge runtime has an unresolved advisory in its optional sandbox dependency; sandbox use remains disabled. See the retest report for exposure and limitations.

The editor adapter, retrieval UI, real-model task runs and automatic model fallback are still to be built. Core plan generation is not a filesystem transaction.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

The official TrueForge repository was inspected at `18b571810ffd2fef29fd79e3731b8fb4295f92cf`. The required Flask release is `3.1.3`, commit `22d924701a6ae2e4cd01e9a15bbaf3946094af65`. Neither upstream repository is vendored here.

Published versions under evaluation: TrueForge `0.185.1`, TypeScript SDK `0.185.0`. The SDK's ESM entry imports successfully on the development machine; its CJS entry fails. Approval behavior must follow the new same-turn pause/resume contract introduced in `0.185.0`.

## Starting point and attribution

From scratch. No upstream editor or agent implementation has been forked or copied. TrueForge is the runtime dependency; ordinary dependencies retain their respective licenses. Research sources are linked in the documents. AI-assisted development uses OpenAI Codex and will be declared in the competition write-up.

The contest PDF, private notes, API credentials, runtime databases and third-party checkouts are not included in this repository.

## License

[MIT](LICENSE).
