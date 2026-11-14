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
pnpm dlx @vscode/vsce@4.1.1 package --no-dependencies --out .runtime/milo-ai-0.2.0.vsix
code --install-extension .runtime/milo-ai-0.2.0.vsix
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

Optional **Milo: Verify applied snapshot** uses `milo.verifyExecutable` and `milo.verifyArgs` to run a trusted command in a temporary copy of loaded files. For a self-contained Python unittest project, use your interpreter and `["-m", "unittest", "discover"]`. Arguments are passed without a shell. This is not an OS sandbox: tests can access the host and spawn descendants. External dependencies are not fingerprinted. Results cover the loaded snapshot and become stale after editor changes.

The index accepts supported UTF-8 text files, at most 512 files and 3.5 million UTF-16 units. It excludes common dependency/build folders and obvious environment/secret filenames and reports partial coverage. It is not an exhaustive secret scanner. New/deleted/renamed files, non-UTF-8 encodings, remote URI schemes and multiple workspace roots are outside this MVP.

## Tests

The current suite has 62 tests, including 1,000 seeded cases. CI runs type checking, tests, build and dependency audit on Windows and Linux. Set `MILO_PYTHON` when Python is not on PATH. Network-restricted runners must allow authenticated ephemeral localhost MCP test connections.

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

On this development machine Windows Application Control blocks native TrueForge SQLite. Debian WSL runs the harness. Windows and WSL loopback are different for MCP callbacks: use VS Code Remote WSL so the extension and harness share a network namespace. Native Windows editor behavior and WSL harness integration have been tested separately; a real-model Remote WSL UI rehearsal is still required. Do not disable application-control or firewall policy.

## Required Flask repository

```sh
pnpm exec tsx scripts/flask-trace.ts <Flask-3.1.3-checkout>
```

This retrieval check observed 181 non-hidden source/document/config files and all six roles for `routes_command`, including tests/docs using its decorator alias `routes`. It is retrieval validation, not a claim to have completed the competition's coding tasks.
