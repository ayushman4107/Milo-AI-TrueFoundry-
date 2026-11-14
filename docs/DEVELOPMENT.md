# Development and validation

## Run Milo

Use Node >=22.14, pnpm 11.25.0 and VS Code >=1.106. The local editor tests used VS Code 1.146.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Press F5 with the included **Run Milo AI** launch configuration. Alternatively:

```sh
pnpm dlx @vscode/vsce@4.1.1 package --no-dependencies --out .runtime/milo-ai-0.4.0.vsix
code --install-extension .runtime/milo-ai-0.4.0.vsix
```

Configure these user/machine settings:

```json
{
  "milo.trueforgeUrl": "http://127.0.0.1:18790",
  "milo.models": ["your-provider/primary", "your-provider/fallback"],
  "milo.pythonExecutable": "/usr/bin/python3"
}
```

Model names are placeholders: configure actual models and credentials in TrueForge. No provider credentials belong in this repository. Use a trusted Python path for your OS. Missing Python blocks Python review instead of silently passing it.

Open one trusted workspace. **Milo: Run repository task** starts repository work; **Milo: Edit selection** restricts edits to selected code. The model discovers, reads and stages through MCP. Its **submit_for_review** tool opens staged diffs and a hunk multi-select. Confirming selected hunks applies them to editor buffers; Save All is separate. **Milo: Cancel run** revokes pending work. **Milo: Undo last apply** restores exact pre-apply content unless subsequent edits conflict. **Milo: Inspect uncertain commit** performs read-only recovery inspection. **Milo: Export run evidence** opens JSON with local excerpts, hashes and a session link: review it before sharing.

Optional **Milo: Verify applied snapshot** uses `milo.verifyExecutable` and `milo.verifyArgs` to run a trusted command in a temporary Git-visible repository copy. For Python unittest, use your interpreter and `["-m", "unittest", "discover"]`. Arguments have no shell interpolation. API keys are not inherited; output, runtime and ordinary process trees are bounded. This is not an OS sandbox: tests can access the host. Python version, pip inventory and captured lockfiles are fingerprinted; external package contents and deliberately escaped descendants remain outside guarantees.

The review screen offers **Verify all staged hunks** when a trusted command is configured. If requested tests changed, it runs them against base production code and the staged version. **Milo: Verify base versus patch** does the same after apply. Inspect the base failure: infrastructure failure is not regression proof. Selecting fewer hunks or rebasing requires verification again. `milo.verifyImport` checks that a module imports from the temporary tree; a single `src/<package>/__init__.py` is auto-detected. Scratch `src` leads `PYTHONPATH` to avoid accidentally importing an editable checkout.

Review shortcuts: **j/k** move, **a/r** accept/reject, **u** undo a decision. Formatting-only Python files are collapsed and unchecked. **Milo: Expand to enclosing Python function** explicitly expands selection. Disjoint stale edits rebase only at unique exact anchors with a new local confirmation; overlaps stop apply.

Enable `milo.scout` for a separate read-only session and advisory work order; this adds model usage. `milo.smallModel` (or **Milo: Toggle small-model preset**) reduces read/context limits and caps repository runs at 24 iterations (inline runs use 12). Both agents choose their own reads. **Milo: Retry with note** keeps visible context but starts a fresh attempt. **Milo: Setup doctor** checks runtime/models, Git and Python; MCP outbound permission remains unknown until a tool call succeeds.

**Milo: Save applied changes with journal** explicitly saves accepted text when disk still matches its pre-apply baseline. Resolve existing unsaved baseline changes first. It fsyncs snapshots and per-file replacements and marks completion. Activation waits for recovery before new commands; incomplete saves roll back only owned post-images, preserving dirty buffers and conflicting edits. Interrupted saves can temporarily leave some files changed. Journals retain source snapshots in extension global storage. Ordinary Save All does not use this journal.

Repository capture requires Git: at most 20,000 paths, 4 MB/file and 64 MB total, including binaries. Model staging remains bounded to 512 UTF-8 files and 3.5 million UTF-16 units; the agent can discover/open indexed paths within that quota. Symlinks and obvious secret paths are excluded and reported. This is not an exhaustive secret scanner. New/deleted/renamed-file edits, non-UTF-8 editing, remote URI schemes and multiple workspace roots are outside this MVP.

## Tests

The current suite has 84 tests, including 1,000 seeded cases. CI runs type checking, tests, build and dependency audit on Windows and Linux. Set `MILO_PYTHON` when Python is not on PATH. Network-restricted runners must allow authenticated ephemeral localhost MCP test connections.

Build integration probes with `node scripts/build.mjs --editor-test --contract`. Launch a real editor test using an isolated profile and:

```text
code --extensionDevelopmentPath=<repo> --extensionTestsPath=<repo>/dist/editor-test.cjs --user-data-dir=<isolated-profile> --disable-workspace-trust <disposable-fixture-folder>
```

The fixture test creates `a.ts`, `b.txt` and `editor-result.json`; never use an important workspace as its fixture. It tests actual editor buffers and disk separately.

## Disposable TrueForge server

Run the server and MCP host in the same OS/network namespace. In a POSIX shell:

```sh
mkdir -p .runtime
HOST=127.0.0.1 PORT=18790 SQLITE_PATH="$PWD/.runtime/probe.sqlite" \
  OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]' \
  npx --yes @truefoundry/trueforge@0.185.1
```

In a second terminal:

```sh
pnpm research:contract
node .runtime/edge-contract.cjs
```

These use a real TrueForge server with deliberately scripted localhost providers, require no paid API key and leave session history in the disposable database. They remove their own temporary registrations. Do not run them against a shared/production instance. Reports are written under ignored `test-results/`; reviewed observations are copied into `docs/research/`.

The production-component probe exercises 401 failover, old-attempt revocation, discovery, staged reads, context budgeting, same-turn approval, local review, apply and undo. It requires a working `MILO_PYTHON`. The older contract probe adds denial, late approval, paused/active cancellation and sandbox-free compaction. Neither proves real-model coding quality.

On this development machine Windows Application Control blocks native TrueForge SQLite. Debian WSL runs the harness. Windows and WSL loopback are different for MCP callbacks: use VS Code Remote WSL so the extension and harness share a network namespace. Public command tests passed in both native Windows and an actual Remote WSL extension host. Physical keys and the complete real-model Flask UI recording are separate, still-unchecked rehearsals. Do not disable application-control or firewall policy.

## Required Flask repository

```sh
pnpm exec tsx scripts/flask-trace.ts <Flask-3.1.3-checkout>
```

This retrieval check observed 181 non-hidden source/document/config files and all six roles for `routes_command`, including tests/docs using its decorator alias `routes`. It is retrieval validation, not a claim to have completed the competition's coding tasks.

## Command and model rehearsals

Build command tests with `node scripts/build.mjs --command-test`, then run `pnpm test:editor` (Linux CI uses xvfb-run). Set `MILO_VSCODE_EXECUTABLE` to use an installed editor. The runner creates an isolated profile and disposable Git workspace. Physical-key checks are in [KEYBOARD-REHEARSAL.md](KEYBOARD-REHEARSAL.md).

[Provider research and fixes](PROVIDER-AND-REHEARSAL.md) documents free-tier limits and actual WSL setup. The example provider manifest is in examples/trueforge-model-provider.json. Configure a private key-file path with MILO_GEMINI_KEY_FILE and run scripts/configure-gemini.mjs; it makes no generation call. Model availability and project quotas must be checked before recording.

Public dotenv fixtures needed by tests can be included via exact milo.verifyFixturePaths entries. Review each file first. This affects verification copies only; it does not expose those paths to model retrieval.
