import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EditorPort } from '../src/editor/adapter.js';
import { CommitCoordinator } from '../src/core/commit-coordinator.js';
import { inversePlan } from '../src/core/change-batch.js';

/** Runs inside a real, isolated VS Code extension host; no mocked editor API. */
export async function run() {
  const root=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;assert(root);
  const extension=vscode.extensions.getExtension('ayushman4107.milo-ai');assert(extension);await extension.activate();
  assert((await vscode.commands.getCommands()).includes('milo.run'));
  const beforeA='const value = "文";\r\n';const beforeB='old\n';
  await writeFile(join(root,'a.ts'),beforeA);await writeFile(join(root,'b.txt'),beforeB);
  const port=new EditorPort(root);const signal=new AbortController().signal;const coordinator=new CommitCoordinator();coordinator.startRun();
  const plan={batchId:'editor-test',changes:[{path:'a.ts',before:beforeA,after:'const value = "💡";\r\n'},{path:'b.txt',before:beforeB,after:'new\n'}]};
  const result=await coordinator.apply(coordinator.issue(plan),port);assert.equal(result.status,'applied');
  const applied=await port.read(['a.ts','b.txt'],signal);assert.equal(applied.get('a.ts'),plan.changes[0]!.after);assert.equal(applied.get('b.txt'),'new\n');
  assert.equal(await readFile(join(root,'a.ts'),'utf8'),beforeA,'apply must not silently save disk');
  assert.equal((await coordinator.apply(coordinator.issue(plan),port)).status,'conflict');
  const inverse=inversePlan(plan,applied);assert.equal((await coordinator.apply(coordinator.issue(inverse),port)).status,'applied');
  assert.equal((await port.read(['a.ts'],signal)).get('a.ts'),beforeA);
  const ticket=coordinator.issue(plan);coordinator.cancel();assert.equal((await coordinator.apply(ticket,port)).status,'cancelled');
  await assert.rejects(port.uri('../outside'));
  await vscode.commands.executeCommand('milo.open');
  await writeFile(join(root,'editor-result.json'),JSON.stringify({status:'passed',checks:['activation','two-file apply','Unicode/CRLF','unsaved disk preserved','stale apply rejected','snapshot undo','cancelled ticket','path escape','workbench command']}));
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}
