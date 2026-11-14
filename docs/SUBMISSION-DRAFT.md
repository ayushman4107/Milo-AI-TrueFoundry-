# Milo AI — write-up draft

This is source for the required 1–3-page PDF. Team details, final benchmark figures and recorded timestamps must be checked before export/submission. No video score is claimed yet.

## 1. Team

Ayushman — GitHub [ayushman4107](https://github.com/ayushman4107). College/employer and any additional members have not been supplied.

## 2. Starting point

Built from scratch. TrueForge source studied at `18b571810ffd2fef29fd79e3731b8fb4295f92cf`; runtime 0.185.1 and SDK 0.185.0. Flask demo baseline: 3.1.3, commit `22d924701a6ae2e4cd01e9a15bbaf3946094af65`. No other team's submission was copied.

## 3. Architecture on TrueForge

The workspace extension snapshots files, exposes authenticated loopback MCP tools, and streams a TrueForge session. TrueForge owns all model execution. Tools discover/read code, stage exact replacements, inspect Python structure, pack context and request review. The model cannot apply editor writes. TrueForge's approval resumes the same turn and opens host review; local hunk decisions produce a one-use compare-and-apply plan. Cancellation revokes the old capability. Undo checks that applied content still matches. Separate read-only Scout sessions and bounded compaction are optional harness features.

## 4. How context is selected

The model searches paths/identifiers and traces exemplars across definitions, registrations, tests and docs. Paginated discovery keeps diverse roles within 6 KB of candidate JSON in the small preset (24 KB standard). Exact line reads establish revision-bound edit evidence. Four-fidelity context packing reports byte inclusion/pruning; token estimates are labeled approximate. Inline mode exposes only the selected file. Small repository runs stop at 24 iterations; inline runs at 12. Exclusions and verification coverage are explicit.

## 5. Model setup

Google Gemini runs remotely through the local TrueForge native provider. Configured IDs are Gemini 3.5 Flash and Flash-Lite; earlier 2.5 pilots and actual quota/model-alias errors are retained in the evaluation record. The user confirmed project billing disabled; no paid usage or billing changes were authorized. One model reported daily exhaustion, so the full two-model matrix cannot be claimed complete. `milo.models` chooses ordered TrueForge model names. Benchmark pacing is an optional localhost transport, not a second agent loop. See [measured results](EVALUATION.md) for completed attempts and token usage.

## 6. Scorecard

| Criterion | Video timestamp | Claim to demonstrate |
|---|---|---|
| A1 | Pending | Selection-bound inline diff and hunk decisions |
| A2 | Pending | Agent-discovered source/test/docs changes across at least three files |
| A3 | Pending | Streaming activity and immediate local cancellation |
| B1 | Pending | Visible bounded context and read provenance |
| B2 | Pending | Individual decisions, explicit apply and guarded undo |
| B3 | Pending | Different configured fallback, unaccepted diff, unchanged workspace |
| B4 | Pending | Same-turn MCP review approval and context tooling/Scout |
| C1 | Pending | Exact A/B/C sequence with verification in at most four minutes |
| C2 | Pending | Reproducible measurements, choices and honest limitations |

## 7. Tools used

OpenAI Codex assisted research, implementation and tests. TypeScript, VS Code APIs, test-electron/Mocha, the TrueForge SDK, MCP SDK, Python AST/symtable, pytest and Git were used. Gemini model calls are described above. Windows and Remote WSL command tests are separate from physical-key validation; scripted providers are labeled as such.

## 8. Known limitations and what you would do with another month

Free-tier quotas limit repetition and recording speed. Model-generated patches can fail despite passing deterministic integration tests. Checklist evidence is advisory; Python parsing is not behavioral correctness, and Task A docstrings require completeness review, including unset/empty values. The full video and physical-key checklist remain pending. Verification uses trusted commands in a temporary copy, not an OS sandbox. Journaled saves are recoverable per-file operations, not cross-file atomic writes. External dependency contents and malicious filesystem races are outside current guarantees.

With another month: evaluate a local small model and stronger providers, improve semantic retrieval and compaction handoff from measured failures, broaden platform/fault coverage, add OS containment, and explore per-hunk chat only after core review reliability. Round 1 uses a cheap one-line reason per hunk and has no second chat path.
