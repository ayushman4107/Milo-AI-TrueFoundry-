| Task/model or failure mode | Checks passed / attempted | Median review-ready | Median fallback start | Reported input/output tokens |
|---|---:|---:|---:|---:|
| C/invalid-key | 3/3 | 67.3 s | 209 ms | 125803/3012 |
| C/closed-port | 2/3 | 42.4 s | 41 ms | 126139/3567 |
| A/google-gemini/flash-lite | 4/4 | 46.7 s | — | 131681/3503 |
| B/google-gemini/flash-lite | 0/4 | — | — | 353413/3259 |

Status: partial-quota-blocked. 22 scheduled runs skipped. A counts behavioral/syntax/scope checks; see the hash-bound manual docstring verdicts in model-evaluation-status.json. The reviewed four-run snapshot has **0/4 complete Task A passes**, because empty/unset documentation is incomplete. New outputs need fresh review. Quota-blocked attempts count as unsuccessful attempts; skipped runs do not enter the denominator. Raw candidate code remains in ignored local reports. Final read/cancel/guidance repairs have deterministic coverage but await a new model run.
