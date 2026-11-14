# Development and validation

This checkpoint contains core code and research probes, not an installable VS Code extension.

## Core tests

Node >=22.14 and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

The current local run passed 41 tests, including 1,000 seeded cases. CI runs these checks on Windows and Linux and includes `pnpm audit --audit-level low`.

## Isolated TrueForge contract test

Start a disposable local TrueForge server in the **same OS/network environment** as the probe. In a POSIX shell:

```sh
mkdir -p .runtime
HOST=127.0.0.1 PORT=18790 SQLITE_PATH="$PWD/.runtime/probe.sqlite" \
  OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]' \
  npx --yes @truefoundry/trueforge@0.185.1
```

In a second terminal:

```sh
TRUEFORGE_BASE_URL=http://127.0.0.1:18790 pnpm research:contract
```

This uses a real TrueForge server and MCP transport with a deliberately scripted localhost model endpoint. It requires no paid API key. Ten checks cover direct/deferred approvals, denial, paused/active cancellation, late approvals, a local fence during a running tool, endpoint authentication, provider-error shape and sandbox-free compaction. Ephemeral fixture credentials are generated per run. It does not prove a real model can implement the Flask tasks.

The probe writes its report to ignored `test-results/runtime-contract.json`; only reviewed, sanitized research results are committed. It removes its temporary model/MCP registrations on exit but leaves session history in the disposable database. No production or shared instance should be used.

On the current development machine, native TrueForge's SQLite module is blocked by Windows Application Control. Running the server and probe together in Debian WSL succeeded. A Windows-hosted MCP probe with a WSL server failed because their loopback interfaces differ. The intended Windows product setup is therefore a VS Code Remote WSL workspace, pending editor validation. No firewall or application-control policy needs to be disabled.
