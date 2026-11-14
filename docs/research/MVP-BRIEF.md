# Milo AI — pre-implementation brief

Build a VS Code coding agent powered entirely by local TrueForge, focused on making changes understandable and reversible.

- **Inline edit:** select code, describe a change, review each changed block in the editor. Edits cannot escape the selection.
- **Agent mode:** a request discovers implementation, tests and documentation through MCP tools, then stages a multi-file change.
- **Explainable context:** a live ledger shows which snippets were exposed, why they were relevant, their revisions and their estimated size budget.
- **Safe review:** TrueForge approval opens the hunk review; selected edits apply against checked revisions, with conflict-aware undo.
- **Resilience:** streaming remains responsive; Cancel revokes pending writes immediately; confirmed model failures switch automatically to another configured TrueForge model.

The main innovation is connecting each proposed change to the exact code evidence it was based on, with a staged batch that cannot overwrite intervening user work.

Use TypeScript, VS Code native diffs, a loopback MCP server, and a pinned compatible TrueForge server/SDK pair. Compaction has now been verified without a sandbox; use selective deferred loading only when its overhead is justified. Do not require a sandbox or subagent to pass the core tasks.

The MVP explicitly covers existing text-file edits and the supplied Flask tasks. No completion engine, accounts, hosted service or model training. Harness contract tests now pass; the editor integration and real-model behavior remain to be verified before claiming a working MVP.

Full research, corrections, protocol, evaluation plan and primary sources: [RESEARCH.md](./RESEARCH.md).
