# Adversarial retest and fixes

Date: 14 November 2026. Scope: all code currently in this repository plus its isolated TrueForge contract probe. Milo is still a core/probe checkpoint, not an installable end-to-end VS Code extension.

## Results

- 41 tests pass, including a seeded generative test with 1,000 combinations of edits, selective acceptance and undo.
- Strict TypeScript checks pass.
- 10 checks pass against real TrueForge 0.185.1 and SDK 0.185.0 with a scripted localhost model endpoint. This is not real-model coding evaluation.
- Milo's dependency audit reports zero known advisories after updating `diff` to 8.0.3.
- The separate TrueForge runtime dependency audit still reports one high-severity advisory in the optional sandbox dependency; see residual risk below.

## Reproduced defects and repairs

Seven new adversarial tests were run against the original code first. All seven failed, confirming the defects; all pass after the repairs.

| Defect | Repair | Scope of guarantee |
|---|---|---|
| Absolute/traversal/ambiguous paths accepted | Require portable repository-relative paths; reject dot segments, backslashes, ADS syntax, control characters, reserved Windows devices and trailing dots/spaces | Lexical boundary, not physical filesystem containment |
| Two case aliases could produce separate plans for one Windows file | Reject differently cased aliases in a batch and duplicate aliases in supplied commit/undo plans | Conservative on case-sensitive filesystems |
| NaN/Infinity selection bounds silently bypassed comparisons | Safe-integer validation at construction and bounds/Unicode checks when observing the selected file | Invalid selection fails before staging |
| Direct staging bypassed diff helper size limits | Bound file size, retained batch characters, evidence count, file count, proposal count, replacement size and resulting file size | Limits are UTF-16 code units, not exact memory bytes |
| Unpaired surrogates collapsed to replacement characters during UTF-8 hashing | Reject malformed Unicode before hashing/diffing/staging; reject NUL-bearing binary text | Prevents this encoding ambiguity, not a general cryptographic proof |
| A stale review could later reuse authorization after content returned to the old text | Conflict cancels the batch and revokes approval | Fresh review required after detected conflict |
| Unsafe integer offsets rounded hunk coordinates | Validate offset and offset + input length as safe integers | Exact supported UTF-16 coordinates |

Additional audit findings addressed:

- The original consumed commit plan was reusable outside the batch and cancellation could not revoke that issued plan. A new host-owned coordinator issues object-identity, one-use tickets, invalidates them across cancellation/new runs, checks state after asynchronous reads, and snapshots caller data. An identical-looking ticket object is not accepted.
- Cancellation during an in-flight atomic commit is reported as `applied_after_cancel` if the adapter confirms it committed; we do not falsely report an unchanged workspace. Unknown write outcomes enter recovery and block new work. Read-only recovery distinguishes unchanged/applied/mixed states and never silently rolls back user content.
- Unresponsive read operations are bounded and cancellation can finish locally even if the adapter ignores its abort signal. Atomic commit completion still depends on the adapter contract; it cannot be safely guessed.
- The probe previously had unauthenticated local endpoints, timestamp-only names and no overall request deadline. It now uses random names, ephemeral bearer credentials, browser-origin rejection and a 90-second request deadline. Generated credentials are not in the committed report.
- CI now has read-only repository permissions, a job timeout and an advisory audit gate.

## Dependency findings

`diff@8.0.2` matched [GHSA-73rr-hh4g-fpgx](https://github.com/advisories/GHSA-73rr-hh4g-fpgx), a denial-of-service issue in patch parsing/application. Milo uses `diffLines`, which the advisory says is unaffected. Nevertheless the vulnerable dependency was replaced with the patched 8.0.3 release and all edit tests were rerun.

The separate research runtime has:

`@truefoundry/trueforge@0.185.1 -> @anthropic-ai/sandbox-runtime@0.0.77 -> zod@3.25.76`

The registry reports [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), uncontrolled resource consumption on oversized invalid collections, patched in Zod >=4.6.6. At inspection, the latest sandbox runtime 0.0.83 still declares Zod `^3.25.0`; there is no verified compatible fix in this dependency line. We did not force a breaking major-version override into third-party runtime code or suppress the finding.

The tested configuration disables sandbox use and binds TrueForge to localhost. That reduces exposure but is not proof the upstream package is vulnerability-free or that every import-time/configuration path is unreachable. Milo's own dependency tree uses Zod 4.6.7 and audits clean. A patched compatible upstream release or an explicitly tested dependency migration remains a prerequisite before enabling that sandbox feature. No advisory was filed or message sent on the user's behalf.

## Stronger live-harness coverage

The original seven checks were rerun. The suite now adds:

1. Missing bearer credentials and browser-origin requests cannot invoke the probe MCP endpoint.
2. An approval sent after a turn is cancelled is rejected and cannot execute the handler.
3. While a delayed MCP handler is running, a local revocation check prevents its action even though TrueForge is also being cancelled.

See [the latest observed report](research/runtime-contract-observed.json). The handler action is a synthetic counter, not a disk write. These observations establish the harness contract and required local fencing; they do not validate the future editor adapter.

## Product edge: implemented vs planned

**Implemented core: verification that becomes stale for the right reasons.** A host-recorded test receipt is bound to the accepted patch, the verification tree's file fingerprints, executable/arguments/working directory and environment fingerprint. Partial acceptance, changed dependencies or a different command cannot reuse the old green result. Timeouts and nonzero exits remain failures. Equivalent content in a new batch can reuse a receipt. This receipt is evidence, never authorization to write.

The trusted runner must supply complete and accurate tree/environment fingerprints. This module cannot detect a dependency omitted by its caller. The actual isolated command runner and receipt UI are not implemented yet.

**Next distinctive capabilities worth building:**

- **Explain rejected edits:** show the specific stale revision, unread range or selection violation and let the TrueForge agent repair its proposal through the existing loop. This should help smaller models without creating a second agent loop.
- **Baseline-aware verification:** show whether a test failure predates Milo's patch or is a new regression. Pair this with patch-bound receipts rather than a generic success badge.
- **Rehearsal evidence export:** export selected hunks, discovery provenance, session IDs and verification timestamps for an honest competition scorecard. Do not manufacture scores from intended features.

These are useful, testable differentiators, not claims that other products lack them.

## Remaining release gates

The current core must not be marketed as a fully robust coding agent. Remaining gates include:

- A real VS Code adapter enforcing document versions at the mutation boundary, dirty-buffer handling, all-or-none text application and save/crash journaling.
- Physical path containment, symlink/junction/hardlink handling and filesystem races. Lexical checks do not solve these.
- An actual MCP boundary validating untrusted JSON, trusted-workspace checks, per-run identity and secret/path exclusions. The authenticated research fixture is not the final server.
- Webview CSP, message validation and escaped rendering of model/repository content.
- Streaming replay/disconnect correctness with actual editor state.
- A command runner with bounded output, process-tree cancellation and honest isolation limits; arbitrary tests can write outside a temporary directory.
- Real-model evaluation, automatic second-model fallback, budgeted retrieval and the three complete Flask demonstrations.
- Resolution or continued exclusion of the upstream optional sandbox dependency risk.

No test count proves these missing components safe. The next development milestone is integrating the hardened core into the editor, then exercising these gates against the real product.

## Follow-up: integrated MVP retest

The earlier “remaining release gates” list describes the previous safety-core checkpoint. The edge implementation now supplies a real editor adapter, authenticated/schema-validated MCP boundary, script-free escaped webview, revision-bound retrieval, bounded context, production TrueForge failover and a disposable-copy command runner. See [the implementation report](EDGE-IMPLEMENTATION.md) and its observed evidence.

Retesting found and corrected a multiline decorator retrieval gap, aggregate overlay-load capacity gap, stale context provenance, overlay changes during asynchronous validation, and per-attempt cancellation/commit-dispatch timing gaps. No unreported path from model tools to direct editor writes was added.

Remaining limits are material: no real-model task evaluation, no end-to-end Remote WSL UI rehearsal, incomplete SSE fault injection, no crash-safe save journal, no OS-level containment for arbitrary verification commands or detached descendants, and no fingerprints for external installed dependencies. Physical path resolution rejects symlinks at inspection but is not an OS-level defense against a malicious local process swapping filesystem objects. Filesystem hardlinks and adversarial races require further treatment before broader deployment. Only loaded-file inventory coverage is asserted. Upstream optional sandbox dependency risk remains unresolved and sandbox use stays disabled.

62 tests, the native editor checks and the scripted-provider production-component harness workflow passed locally. These demonstrate specific tested behavior, not universal robustness or real-model coding accuracy.
