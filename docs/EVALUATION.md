# Real-model evaluation and rehearsal

No real-model score is currently claimed: the local TrueForge provider registry was empty. Scripted providers prove integration and fault behavior only. Credentials belong in TrueForge, never in the repo or exported evidence.

Build `node scripts/build.mjs --evaluation`. Run in TrueForge's OS/network namespace with a native Python environment containing Flask dependencies:

```sh
MILO_EVAL_MODELS='["provider/weak-model","provider/strong-model"]' \
  MILO_PYTHON=/path/to/python \
  node .runtime/model-evaluation.cjs /path/to/clean/flask-3.1.3 --run
```

Set `TRUEFORGE_BASE_URL` if needed. Names are placeholders. The runner makes ten attempts per model with a ten-minute attempt limit; provider usage/cost applies. It checks the exact Flask commit and clean checkout, uses production driver/MCP/workbench, restricts editing to the selected function, and accepts hunks only into an offline snapshot. Checkout files remain untouched. Results checkpoint after each attempt in ignored `test-results/model-evaluation.json`: time to diff, session, guard failures, provenance, reported usage, import canary and verification.

Task A checks unset/empty, existing false values, case-insensitive off/n and representative true values. The proposed docstring is printed for review; semantic checks alone do not earn a complete Task A score. Review each docstring, record model/provider location and cost, and retain failures. Offline evaluation is not an editor demonstration.

## Four-minute rehearsal target

Use the exact problem-statement prompts. Rehearse on both configured models in separate disposable Flask 3.1.3 checkouts; never reset a user's working tree.

| Segment | Task | Visible evidence |
| --- | --- | --- |
| 0:00–1:00 | A: select get_debug_flag, request off/n false and complete docstring | Preview, accept, temporary-source import canary and FLASK_DEBUG=off printing False |
| 1:00–3:15 | B: built-in flask config, masked JSON, help, test and docs; name no files | Discovery, at least three changed files, checklist, review, TrueForge session, passing pytest tests/test_cli.py -q, help and masked JSON against a sample app |
| 3:15–4:00 | C: repeat A with invalid/unreachable provider and optional healthy fallback | Responsive editor, clear error or fallback, leave diff unaccepted, unchanged Git status |

Timing is a target, not an observed result. Preserve actual durations, model names, approximate cost and failures. For differential verification, inspect the base output to distinguish the intended assertion from missing dependencies or infrastructure failure.

Native Windows TrueForge SQLite is blocked by Application Control on this machine. Use Remote WSL with native WSL Python and TrueForge so MCP callbacks share loopback. Windows Python supports parser probes over stdin from WSL, but is not a substitute for Linux temporary-tree import verification. Native editor and WSL harness checks passed separately; a full Remote WSL real-model rehearsal remains unmeasured.

## Remaining native review check

The review layout was observed in VS Code. Keyboard/script decisions, escaping, explicit confirmation and verification-status messages pass an isolated script test. The desktop helper could not complete native input, reporting “window is minimized” and “user input was detected.” Build `--review-ui` and run `dist/review-ui-test.cjs` as the extension test path. Exercise r/u, j/k, formatting acceptance/rejection, and confirm source and test only. Success writes `review-ui-result.json`; no successful native keyboard result is currently recorded.
