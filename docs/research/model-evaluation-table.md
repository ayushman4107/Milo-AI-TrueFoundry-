| Task/model or failure mode | Checks passed / attempted | Median review-ready | Median fallback start | Reported input/output tokens |
|---|---:|---:|---:|---:|
| C/invalid-key | 2/2 | 63.3 s | 336 ms | 76852/1844 |
| C/closed-port | 2/2 | 42.4 s | 42 ms | 81161/1862 |
| A/google-gemini/flash-lite | 1/1 | 48.4 s | — | 27680/667 |
| B/google-gemini/flash-lite | 0/1 | — | — | 103127/1067 |

Status: running. 2 scheduled runs skipped. A counts behavioral/syntax/scope checks, not full rubric passes. Quota-blocked attempts count as unsuccessful attempts; skipped runs do not enter the denominator. Raw candidate code remains in ignored local reports.
