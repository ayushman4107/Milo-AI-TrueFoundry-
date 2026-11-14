// Opt-in real-provider rehearsal. Run ONLY in a disposable, clean Flask 3.1.3 workspace.
import * as vscode from 'vscode';import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createServer} from 'node:net';import {randomUUID} from 'node:crypto';
import {analyzePython} from '../src/core/python-analysis.js';import {captureRepository} from '../src/core/repository.js';import {TASK_A,TASK_B,CHECK_A,CHECK_B,safeError} from '../scripts/eval-cases.js';
export async function run(){
 assert.equal(vscode.env.remoteName,'wsl');const root=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;assert(root&&root.endsWith('/flask-demo'),'Use the disposable flask-demo checkout');
 const extension=vscode.extensions.getExtension('ayushman4107.milo-ai')!;const output=join(extension.extensionPath,'test-results','wsl-flask-live.json');const rows:Record<string,unknown>[]=[];
 const python='/home/bengaltiger/milo-rehearsal/venv/bin/python';const cfg=vscode.workspace.getConfiguration('milo');
 for(const [key,value] of Object.entries({trueforgeUrl:'http://127.0.0.1:18790',models:['google-gemini/flash-lite'],smallModel:true,pythonExecutable:python,verifyExecutable:python,verifyImport:'flask',verifyFixturePaths:['tests/test_apps/.env']}))await cfg.update(key,value,vscode.ConfigurationTarget.Global);
 const api=await extension.activate() as {snapshot:()=>{busy:boolean;status:string;review?:unknown}};const original=await captureRepository(root,new Map(),undefined,new Set(['tests/test_apps/.env']));
 for(const task of ['A','B','C']){
  const start=Date.now();const row:Record<string,unknown>={task,status:'failed',physicalKeys:false};let pending:Thenable<unknown>|undefined;let bad='';
  try{
   if(task==='C'){
    const server=createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert(address&&typeof address!=='string');await new Promise<void>(r=>server.close(()=>r()));bad=`milo-editor-failure-${randomUUID()}`;
    const r=await fetch('http://127.0.0.1:18790/api/v1/settings/model-providers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({manifest:{type:'custom',name:bad,base_url:`http://127.0.0.1:${address.port}/v1`,auth:{api_key:'not-a-live-key'},models:[{name:'failure',model_id:'failure',properties:{context_length:32000}}]}})});assert(r.ok);await cfg.update('models',[`${bad}/failure`,'google-gemini/flash-lite'],vscode.ConfigurationTarget.Global);
   }
   const doc:vscode.TextDocument=await vscode.workspace.openTextDocument(vscode.Uri.file(join(root,'src/flask/helpers.py')));const before:string=doc.getText();const editor=await vscode.window.showTextDocument(doc);const fn=(await analyzePython(before,{python})).nodes?.find(n=>n.name==='get_debug_flag');assert(fn);editor.selection=new vscode.Selection(doc.positionAt(fn.start),doc.positionAt(fn.end));
   let ended=false;pending=vscode.commands.executeCommand(task==='B'?'milo.run':'milo.inline',task==='B'?TASK_B:TASK_A).then(()=>{ended=true;});
   const deadline=Date.now()+8*60*1000;while(!api.snapshot().review&&!ended){if(Date.now()>deadline)throw new Error('Review timeout');await new Promise(r=>setTimeout(r,200));}
   assert(api.snapshot().review,api.snapshot().status);row.timeToReviewMs=Date.now()-start;row.diffTabOpened=vscode.window.tabGroups.all.flatMap(g=>g.tabs).some(t=>t.input instanceof vscode.TabInputTextDiff);assert(row.diffTabOpened);
   await vscode.commands.executeCommand(task==='C'?'milo.review.cancel':'milo.review.confirm');await pending;
   if(task==='C')assert.equal(doc.getText(),before);else{
    await cfg.update('verifyArgs',['-c',task==='A'?CHECK_A:CHECK_B],vscode.ConfigurationTarget.Global);await vscode.commands.executeCommand('milo.verify');row.verification=api.snapshot().status;assert.match(String(row.verification),/^Verification passed /);
    await vscode.commands.executeCommand('milo.undo');assert.equal(doc.getText(),before);
   }
   row.status='passed';
  }catch(e){row.error=safeError(e);}finally{
   await vscode.commands.executeCommand('milo.cancel');await pending;await vscode.commands.executeCommand('milo.undo');
   if(bad)await fetch(`http://127.0.0.1:18790/api/v1/settings/model-providers/${bad}`,{method:'DELETE'});await cfg.update('models',['google-gemini/flash-lite'],vscode.ConfigurationTarget.Global);
   row.diskUnchanged=(await captureRepository(root,new Map(),undefined,new Set(['tests/test_apps/.env']))).fingerprint===original.fingerprint;row.elapsedMs=Date.now()-start;rows.push(row);await writeFile(output,JSON.stringify({scope:'Actual Remote WSL extension, real TrueForge and Gemini; command-driven review, no physical keystrokes',rows},null,2));
  }
 }
 if(rows.some(r=>r.status!=='passed'||!r.diskUnchanged))throw new Error('Some live rehearsal checks failed; see the checkpoint report');
}
