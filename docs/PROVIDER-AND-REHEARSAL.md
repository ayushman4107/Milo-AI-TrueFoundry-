# Provider and rehearsal research, plan and implementation

Research and experiments: 15 November 2026 IST. API use is authorized only within the user's confirmed billing-disabled Google project. No billing changes or paid fallback providers were used. Credentials stay outside Git and are registered in the private local TrueForge database.

## Research findings

- Google supports its native Gemini interface and an [OpenAI-compatible interface](https://ai.google.dev/gemini-api/docs/openai). Milo's healthy sessions use TrueForge's native `google-gemini` adapter. The invalid-key experiment uses the compatible endpoint with a deliberately invalid value.
- [Billing](https://ai.google.dev/gemini-api/docs/billing) is determined by the project, not a model name. The user confirmed billing is disabled before generation calls. [Pricing](https://ai.google.dev/gemini-api/docs/pricing) and available models were checked; metadata availability does not prove a model will accept generation requests.
- Discovery advertised 2.5 Flash-Lite, but generation rejected it as unavailable to new users. 3.5 Flash-Lite accepted generation. The Flash alias also returned rate/quota errors naming an underlying 3.6 model. Reports preserve configured names and actual provider errors; there is no claim of a local 7B stress test.
- Actual errors reported 15 RPM for Lite and 5 RPM for Flash. A separate Flash response reported a daily limit exhausted with a roughly 13-hour retry delay. These are observations for this project, not general Google quotas.
- TrueForge 0.185.1 reports Google invalid credentials through the compatible endpoint as generic HTTP 400, and a refused socket as `[Model Error] Cannot connect to API: connect ECONNREFUSED …`. Neither matched the previous failover classifier.
- Microsoft's [extension testing guide](https://code.visualstudio.com/api/working-with-extensions/testing-extension) supports command tests in a real editor. [Remote extension guidance](https://code.visualstudio.com/api/advanced-topics/remote-extensions) requires the workspace extension to execute on the remote side; a Windows webview does not imply Windows MCP networking.

## Implementation plan and completed changes

1. Discover models without printing credentials; configure two named TrueForge models; retain failed pilots.
2. Expand the immutable-snapshot benchmark to A/B/C, baseline identity, native Python checks, checkpoints, latency and provider token usage. Never run destructive checkout-clean commands in a user's workspace.
3. Fix tool-argument problems before speed: state the inclusive read limit, distinguish filenames from identifiers, and support exact-text staging with all existing read/revision/selection checks. Inline mode now loads only its selected file and caps the run at 12 iterations; small repository runs cap at 24.
4. Recognize the observed terminal errors. Generic HTTP 400 is a provider rejection, not proof of invalid authentication. Fallback still requires old-session revocation and no dispatched writes; assistant/tool text cannot trigger it.
5. Add an optional authenticated localhost pacing transport for benchmarks. It forwards only allowed Gemini generation paths to the official Google host, spaces Lite starts by 4.5 seconds and Flash starts by at least 13 seconds, and never retries. Daily exhaustion remains a stop condition. TrueForge owns every model turn.
6. Move review decisions to a shared host-owned state; expose public commands and visible controls; retain nonce and focus guards. Add one-line requirement evidence instead of per-hunk chat.
7. Run official test-electron/Mocha checks against Windows and a real Remote WSL extension host. Patch vulnerable test-only `glob` and `minimatch` dependencies; add editor commands to Windows/Linux CI.
8. Rehearse real Flask tasks separately in a disposable Remote WSL checkout. Keep physical-key and recording checklist items explicitly pending until exercised.

## Native WSL environment

Debian, native Node 22.16.0, TrueForge 0.185.1 and Python 3.13.5 run in the same WSL namespace. Flask lives on the Linux filesystem at the pinned 3.1.3 commit. Its clean baseline has **58 passing CLI tests** with pytest 8.4.2, python-dotenv and asgiref. The initially installed pytest 9.2.0 failed Flask's private `notset` import; pinning the compatible test dependency restored the baseline. `core.autocrlf=false` preserves checkout line endings; Milo's CRLF/Unicode tests remain enabled.

The loopback MCP outbound allowlist is `127.0.0.1` and `localhost`. The runtime uses a private SQLite directory and loopback binding. Windows Application Control's SQLite restriction was left in place. Model keys are never put in VS Code settings or reports. Known public dotenv fixtures can be included in verification via exact `milo.verifyFixturePaths`; this setting does not widen model context.

Observed command reports: [Windows](research/windows-command-observed.json), [Remote WSL](research/wsl-command-observed.json). Actual model measurements and their limits belong in [evaluation](EVALUATION.md). The physical-key checklist is [separate](KEYBOARD-REHEARSAL.md).
