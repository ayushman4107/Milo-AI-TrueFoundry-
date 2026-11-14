# Real-model evaluation and rehearsal

Gemini credentials are configured in a private native WSL TrueForge instance. The user confirmed a free-tier project with billing disabled. No paid provider or billing change is used. Model availability and quotas were measured rather than inferred from discovery metadata.

The [compact trial record](research/model-evaluation-status.json) retains failed pilots, interrupted tuning attempts and the repeated benchmark separately. The [measurement table](research/model-evaluation-table.md) reports actual denominators, latency and provider-reported tokens. **Task A's pass count covers behavior, syntax and selection scope; it is not a complete rubric score.** Its docstring must also list unset/empty, 0, false, no, off and n with case-insensitivity. Missing entries cannot be excused by a passing behavior test.

The stronger configured Flash model reported daily free-quota exhaustion. Its scheduled runs are explicitly skipped; this is not a completed two-model comparison and neither Gemini model is a local 7–8B stress test. Per-minute failures were recorded before adding conservative pacing. There is no claim that free-tier pacing fits the four-minute recording target.

## Reproduce the benchmark

Use a clean disposable Flask 3.1.3 checkout at `22d924701a6ae2e4cd01e9a15bbaf3946094af65`, with TrueForge and the runner in the same network namespace. Install Flask dependencies, python-dotenv, asgiref and a compatible pytest (8.4.2 passed the 58-test clean CLI baseline on Python 3.13.5).

```sh
node scripts/build.mjs --evaluation
MILO_EVAL_MODELS='["google-gemini/flash-lite","google-gemini/flash"]' \
MILO_PYTHON=/path/to/venv/bin/python \
node .runtime/model-evaluation.cjs /path/to/flask --run
```

The default matrix is A ten times/model, B five times/model, C three times/failure mode: **36 scheduled attempts**. `MILO_EVAL_TASKS`, `MILO_EVAL_REPEATS`, `MILO_EVAL_B_REPEATS`, `MILO_EVAL_C_REPEATS`, `MILO_EVAL_OUTPUT` and `TRUEFORGE_BASE_URL` customize an explicit run. `MILO_EVAL_BLOCKED_MODELS` is a JSON array for models already known to be quota-blocked; `MILO_EVAL_FALLBACK_MODEL` chooses the available healthy C target. Do not use those options to hide failures.

Each run starts with a fresh workbench over the same immutable checkout snapshot; a fingerprint check detects checkout changes. No destructive `git clean`/reset is used. The agent receives the task and, for A/C, the user's selected function. B receives no prescribed filenames. A/B acceptance happens only in an offline temporary tree. C rejects the proposal and tests whether the healthy model reaches review. SIGINT/SIGTERM revoke the active attempt and checkpoint the interrupted run.

Recorded fields include diff prepared (native rendering explicitly unmeasured here), syntax, selection scope, changed paths, generic checklist evidence, native Python test output, time to review, fallback start, usage and errors. A checks 15 environment cases. B requires at least three changed files, checklist evidence, passing `pytest tests/test_cli.py -q`, help visibility, valid masked JSON, complete configuration keys and unchanged application configuration. Temporary-source import canaries prevent accidentally testing an installed or editable baseline.

Fallback-start latency ends when the healthy attempt starts; it is not time to a completed diff. Timings include provider pacing and, where noted, concurrent rehearsal queueing. Context byte budgets and token counts are different quantities. Costs remain within the confirmed free-tier project; token totals are not a billing statement.

Any provider quota failure stops remaining runs for that model in that invocation. Respect the reported cooldown before a separate run; daily exhaustion needs a reset. The optional `scripts/gemini-quota-proxy.mjs` spaces Lite requests by 4.5 seconds and Flash by at least 13 seconds, forwards only allowed Google generation endpoints and does no retries. Start it with `MILO_GEMINI_KEY_FILE` pointing outside the repository, then configure TrueForge with `node scripts/configure-gemini.mjs --paced`. Restore the official base URL with the same command without `--paced` before stopping the proxy.

`node scripts/summarize-evaluation.mjs` exports compact reviewed measurements. Raw patches, complete tool transcripts, model thought signatures, private settings and databases remain outside committed evidence. Keep any revised prompt/tool design labeled separately from earlier trials.

## Native editor evidence

[Windows commands](research/windows-command-observed.json) and [actual Remote WSL commands](research/wsl-command-observed.json) passed against deterministic fixtures. The [live Remote WSL rehearsal](research/wsl-flask-live.json) uses real TrueForge/Gemini and a separate native Linux Flask checkout; the [earlier failed rehearsal](research/wsl-flask-before-retrieval-fix.json) is retained. A diff tab opening is recorded independently of physical-key input or a completed video. Failures and unchanged disk checks are part of the report.

Build the opt-in live test with `node scripts/build.mjs --flask-host`. `tests/flask-host.ts` intentionally requires Remote WSL and a disposable directory named `flask-demo`; its current interpreter/model settings describe this rehearsal machine. It makes real provider requests and must only be run within authorized quota. Public commands apply, verify and undo A/B buffers; C declines the review. It does not simulate physical keys.

## Four-minute recording checklist

| Target segment | Task | Evidence to show |
|---|---|---|
| 0:00–1:00 | A | Function selection, exact prompt, diff, hunk decisions, complete docstring, verified off → False |
| 1:00–3:15 | B | Agent discovery, ≥3 files, checklist, review, TrueForge session, CLI pytest, help, masked JSON |
| 3:15–4:00 | C | Invalid/unreachable provider, healthy fallback, proposal left unaccepted, unchanged workspace |

These are targets, not recorded timestamps. Complete the [physical-key checklist](KEYBOARD-REHEARSAL.md) on the recording machine. Per-hunk chat is excluded from Round 1 and appears only under future work in [write-up heading 8](SUBMISSION-DRAFT.md).
