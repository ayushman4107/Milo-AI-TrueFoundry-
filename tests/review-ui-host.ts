import * as vscode from 'vscode';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {keyboardReview} from '../src/editor/review.js';
import assert from 'node:assert/strict';
export async function run(){
  const root=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;assert(root);
  const ids=await keyboardReview([
    {id:'source',path:'src/helpers.py',role:'source',before:'return value == "off"',after:'return value in {"off", "n"}',formattingOnly:false,warnings:[]},
    {id:'format',path:'src/style.py',role:'source',before:'x = 1',after:'x=1',formattingOnly:true,warnings:[]},
    {id:'test',path:'tests/test_helpers.py',role:'tests',before:'',after:'assert helper("n") is False\n# <img src=x onerror="alert(1)">',formattingOnly:false,warnings:['Example warning: unresolved name is advisory, not a verdict.']}
  ],[{id:'docs',label:'Documentation requested',status:'missing',paths:[],explanation:'No documentation diff; behavioral claims are not inferred.'}],AbortSignal.timeout(300000));
  assert.deepEqual(ids,['source','test']);await writeFile(join(root,'review-ui-result.json'),JSON.stringify({status:'passed',accepted:ids,formattingExcluded:true}));
}
