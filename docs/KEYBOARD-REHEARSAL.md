# Keyboard and recording rehearsal

Automated evidence: public extension commands pass in native Windows and Remote WSL (VS Code 1.146). These tests use a deterministic localhost TrueForge fixture; they do not simulate physical keys. The webview script separately tests focus, input exclusion, host-owned decisions, escaped content and nonce checks.

## Shortcuts and visible alternatives

| Action | Windows/Linux chord | Alternative |
|---|---|---|
| Inline edit | Ctrl+K, Ctrl+Alt+I | Workbench Edit selection; Command Palette |
| Accept active hunk | Ctrl+K, Ctrl+Alt+A | Accept hunk button; palette |
| Reject active hunk | Ctrl+K, Ctrl+Alt+R | Reject hunk button; palette |
| Apply selected hunks | Ctrl+K, Ctrl+Alt+Enter | Apply selected button; palette |
| Cancel run | Ctrl+K, Ctrl+Alt+Q | Workbench Cancel run; palette |
| Undo last apply | Ctrl+K, Ctrl+Alt+U | Workbench Undo last apply; palette |

On macOS the first chord uses Cmd+K; the second uses Ctrl+Alt. macOS is not rehearsed. The installed Windows/Linux default bindings had no exact collisions. User extensions, remapped keys, keyboard layouts and chord-prefix conflicts can still interfere. An initial cancel binding collided with VS Code's default and was changed to Q.

Within the focused review panel, j/k move, a/r accept/reject and u undoes a decision. These keys are ignored while typing in inputs, during composition, with Ctrl/Alt/Meta, or without document focus. Decisions remain in the extension host. Only explicit confirmation can request application of the selected hunks.

## Ten-minute physical-key checklist — pending

Use a disposable Flask checkout and the machine/profile used for the recording. Record platform, layout and VS Code version alongside the ticks. Do not tick a physical check based on command-test results.

- [ ] Select `get_debug_flag`, press the inline chord, type the exact Task A instruction and submit.
- [ ] Confirm that a staged diff and review controls appear before any buffer changes.
- [ ] Focus the review; use j/k, a/r and u. Confirm visible selection follows each decision.
- [ ] Type those letters in the instruction input. Confirm no review decision changes.
- [ ] Switch to another editor/input. Confirm single-letter review actions do not fire.
- [ ] Apply selected hunks with the chord; confirm only those buffer changes appear.
- [ ] Undo with the chord; compare exact pre-apply text and unchanged disk contents.
- [ ] Start another run and cancel with the chord, both while generating and during review.
- [ ] Repeat each action with its visible control and Command Palette entry.
- [ ] Record A, B and C in order within four minutes; leave Task C's proposal unaccepted.

Per-hunk chat is excluded from Round 1. A one-line file/checklist reason appears with each hunk without another model request. Future conversational review belongs in heading 8 of the write-up.
