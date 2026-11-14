import * as vscode from 'vscode';
import { realpath, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { validatePath } from '../core/validation.js';
import type { AtomicEditorPort } from '../core/commit-coordinator.js';
import type { CommitPlan } from '../core/change-batch.js';

export class EditorPort implements AtomicEditorPort {
  constructor(readonly root: string) {}
  async uri(path: string) {
    validatePath(path); const base=await realpath(this.root); const target=resolve(base,...path.split('/'));
    // Refuse symlinks/reparse aliases component by component, including the final file.
    let cursor=base;
    for(const part of path.split('/')){cursor=resolve(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw new Error('Symlink paths are outside this MVP');}
    const physical=await realpath(target);const rel=relative(base,physical);
    if(!rel || isAbsolute(rel) || rel==='..' || rel.startsWith(`..${process.platform==='win32'?'\\':'/'}`))throw new Error('Path escapes workspace');
    return vscode.Uri.file(physical);
  }
  async read(paths: readonly string[],signal:AbortSignal) {
    const result=new Map<string,string>();
    for(const p of paths){signal.throwIfAborted();const doc=await vscode.workspace.openTextDocument(await this.uri(p));signal.throwIfAborted();result.set(p,doc.getText());}
    return result;
  }
  async compareAndSwap(plan:CommitPlan,signal:AbortSignal):Promise<'applied'|'rejected'> {
    const documents = [];
    for(const file of plan.changes){signal.throwIfAborted();documents.push({file,doc:await vscode.workspace.openTextDocument(await this.uri(file.path))});}
    // No await between these comparisons and applyEdit: VS Code serializes open-document versions here.
    signal.throwIfAborted();const edit=new vscode.WorkspaceEdit();
    for(const {file,doc} of documents){if(doc.isClosed || doc.getText()!==file.before)return 'rejected';edit.replace(doc.uri,new vscode.Range(doc.positionAt(0),doc.positionAt(file.before.length)),file.after);}
    return await vscode.workspace.applyEdit(edit) ? 'applied' : 'rejected';
  }
}
