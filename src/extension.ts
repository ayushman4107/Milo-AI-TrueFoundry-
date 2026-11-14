import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { relative } from 'node:path';
import { EditorPort } from './editor/adapter.js';
import { Workbench } from './core/workbench.js';
import { CommitCoordinator } from './core/commit-coordinator.js';
import { digest, inversePlan, type CommitPlan, type Snapshot } from './core/change-batch.js';
import { compareInventory, type Inventory } from './core/overlay.js';
import { checkPython } from './core/python-syntax.js';
import { ModelFailover } from './core/failover.js';
import { startBridge, type Review } from './bridge/mcp.js';
import { TrueForgeDriver } from './bridge/trueforge.js';
import { verifySnapshot } from './core/verify-runner.js';
import { VerificationLedger } from './core/verification.js';

const escape = (value:string) => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function activate(context:vscode.ExtensionContext) {
  const output=vscode.window.createOutputChannel('Milo AI');context.subscriptions.push(output);
  const coordinator=new CommitCoordinator();const failover=new ModelFailover();
  let controller:AbortController|undefined;let busy=false;let lastPlan:CommitPlan|undefined;let lastPort:EditorPort|undefined;
  let lastPaths:string[]=[];let receiptId:string|undefined;const verification=new VerificationLedger();
  let panel:vscode.WebviewPanel|undefined;let sessionUrl='';let latestTimeline='';let ledger='';let status='Ready';let lastPaint=0;
  const previews=new Map<string,string>();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('milo-preview',{provideTextDocumentContent:uri=>previews.get(uri.toString())??'Preview expired'}));
  const paint=(force=false)=>{
    if(!panel || (!force && Date.now()-lastPaint<250))return;lastPaint=Date.now();
    const nonce=randomBytes(16).toString('hex');
    panel.webview.html=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';"><style nonce="${nonce}">body{font:14px var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;max-width:1000px}h1{font-size:30px}p{line-height:1.7}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:var(--vscode-textCodeBlock-background)}.tag{padding:8px;border:1px solid var(--vscode-panel-border)}a{color:var(--vscode-textLink-foreground)}</style></head><body><h1>Milo AI</h1><p class="tag">${escape(status)}</p><p>Use the command palette: Milo: Run task, Inline edit, Cancel run, Undo last apply. Changes remain in a shadow copy until you review individual hunks.</p>${sessionUrl?`<p><a href="${escape(sessionUrl)}">Open this TrueForge session</a></p>`:''}<h2>Harness timeline</h2><pre>${escape(latestTimeline||'No model turn yet.')}</pre><h2>Context evidence</h2><pre>${escape(ledger||'No code exposed yet.')}</pre></body></html>`;
  };
  const show=()=>{if(!panel){panel=vscode.window.createWebviewPanel('milo','Milo AI',vscode.ViewColumn.Beside,{enableScripts:false});panel.onDidDispose(()=>{panel=undefined;});}else panel.reveal();paint(true);};
  const log=(message:string)=>{status=message;output.appendLine(message);paint(true);};
  const cfg=()=>vscode.workspace.getConfiguration('milo');
  const python=()=>cfg().get<string>('pythonExecutable') || undefined;
  const syntax=async(plan:CommitPlan,signal:AbortSignal)=>{
    for(const f of plan.changes.filter(f=>f.path.endsWith('.py'))){const result=await checkPython(f.after,{signal,...(python()?{executable:python()!}:{})});signal.throwIfAborted();if(result.status!=='valid')throw new Error(`${f.path}: ${result.message}`);}
  };
  const review=async(w:Workbench,r:Review,port:EditorPort,signal:AbortSignal,onCommit:()=>void)=>{
    signal.throwIfAborted();log(`Review ready: ${r.proposals.length} hunks. Nothing applied.`);
    const source=new Map(w.files().map(f=>[f.path,f.text]));
    const items=r.proposals.map((p,i)=>({label:`${i+1}. ${p.path}`,description:`UTF-16 ${p.span.start}–${p.span.end}`,detail:`Replacement: ${p.replacement.slice(0,300) || '(delete)'}`,picked:true,id:p.id}));
    const token=new vscode.CancellationTokenSource();const abort=()=>{token.cancel();coordinator.cancel();};signal.addEventListener('abort',abort,{once:true});
    try{
      for(const path of [...new Set(r.proposals.map(p=>p.path))]){
        signal.throwIfAborted();const uri=vscode.Uri.parse(`milo-preview:/${encodeURIComponent(r.batchId)}/${path}`);previews.set(uri.toString(),source.get(path)!);
        await vscode.commands.executeCommand('vscode.diff',await port.uri(path),uri,`Milo staged: ${path}`,{preview:true});
      }
      const picked=await vscode.window.showQuickPick(items,{canPickMany:true,title:'Milo: select hunks to apply to editor buffers',ignoreFocusOut:true,placeHolder:'Uncheck unwanted hunks. Escape rejects the batch.'},token.token);
      signal.throwIfAborted();if(!picked?.length){w.cancel();return {status:'declined'};}
      const paths=[...new Set(r.proposals.map(p=>p.path))];const current=await port.read(paths,signal);signal.throwIfAborted();
      const plan=w.accept(picked.map(p=>p.id),current);await syntax(plan,signal);signal.throwIfAborted();
      onCommit();const result=await coordinator.apply(coordinator.issue(plan),port);
      if(result.status==='applied'||result.status==='applied_after_cancel'){lastPlan=plan;lastPort=port;lastPaths=w.files().map(f=>f.path);log(`Applied ${plan.changes.length} files to editor buffers. Python syntax checked; project tests not run. Use Save All to persist.`);}
      else log(`Commit ${result.status}`);
      return result;
    }finally{signal.removeEventListener('abort',abort);token.dispose();previews.clear();}
  };
  async function inventory(port:EditorPort,paths:string[]):Promise<Inventory>{
    const disk=new Map<string,string>();const buffers=new Map<string,string>();
    for(const path of paths){try{const uri=await port.uri(path);disk.set(path,createHash('sha256').update(await readFile(uri.fsPath)).digest('hex'));const doc=vscode.workspace.textDocuments.find(d=>d.uri.toString()===uri.toString());if(doc)buffers.set(path,digest(doc.getText()));}catch{disk.set(path,'unavailable');}}
    return {complete:false,disk,buffers}; // Loaded subset only; never claim whole-workspace cleanliness.
  }
  async function run(inline:boolean){
    if(busy)throw new Error('A run is active. Cancel it first.');
    if(!vscode.workspace.isTrusted)throw new Error('Milo requires a trusted workspace.');
    const folder=vscode.workspace.workspaceFolders?.[0];if(!folder||folder.uri.scheme!=='file'||vscode.workspace.workspaceFolders?.length!==1)throw new Error('Open one local workspace (or a VS Code Remote WSL workspace).');
    const editor=vscode.window.activeTextEditor;
    if(inline&&(!editor||editor.selection.isEmpty))throw new Error('Select the code to edit first.');
    const request=await vscode.window.showInputBox({title:inline?'Milo inline edit':'Milo repository task',prompt:'Describe the change. Code is sent through your configured local TrueForge runtime.',ignoreFocusOut:true});if(!request)return;
    const models=cfg().get<string[]>('models',[]);if(!models.length)throw new Error('Set milo.models to ordered model names already configured in TrueForge.');
    if(busy)throw new Error('Another run started while the input box was open.');
    coordinator.startRun();busy=true;controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15*60*1000)]);const cancelCommit=()=>coordinator.cancel();signal.addEventListener('abort',cancelCommit,{once:true});show();
    let driver:TrueForgeDriver|undefined;let activeWorkbench:Workbench|undefined;let sideEffects=false;const port=new EditorPort(folder.uri.fsPath);lastPort=port;let paths:string[]=[];let baseline:Inventory|undefined;
    try{
      const uris=await vscode.workspace.findFiles('**/*.{py,ts,tsx,js,jsx,json,md,rst,toml,yaml,yml,txt}','**/{.git,.venv,venv,node_modules,dist,build,.env,.codex,.agents}/**',1000);
      const files:Snapshot[]=[];let size=0;let excluded=0;
      const selected=inline&&editor ? relative(folder.uri.fsPath,editor.document.uri.fsPath).replaceAll('\\','/') : undefined;
      uris.sort((a,b)=>a.fsPath===editor?.document.uri.fsPath?-1:b.fsPath===editor?.document.uri.fsPath?1:a.fsPath.localeCompare(b.fsPath));
      for(const uri of uris){signal.throwIfAborted();const path=relative(folder.uri.fsPath,uri.fsPath).replaceAll('\\','/');
        if(/(?:^|\/)(?:\.env|credentials|secrets)(?:[.\/]|$)/i.test(path)){excluded++;continue;}
        try{const physical=await port.uri(path);const raw=await readFile(physical.fsPath);if(raw.length>1_000_000)throw new Error('large');new TextDecoder('utf-8',{fatal:true}).decode(raw);
          const doc=await vscode.workspace.openTextDocument(physical);const text=doc.getText();
          if(files.length>=512||size+text.length>3_500_000){excluded++;continue;}files.push({path,text});size+=text.length;
        }catch{excluded++;}
      }
      if(selected&&!files.some(f=>f.path===selected))throw new Error('Selected file cannot be safely loaded.');
      if(!files.length)throw new Error('No supported source files found.');paths=files.map(f=>f.path);baseline=await inventory(port,paths);
      const selection=selected&&editor?{path:selected,span:{start:editor.document.offsetAt(editor.selection.start),end:editor.document.offsetAt(editor.selection.end)}}:undefined;
      log(`Loaded ${files.length} files; ${excluded} excluded; inventory is partial. No workspace writes.`);
      driver=new TrueForgeDriver({baseUrl:cfg().get('trueforgeUrl','http://127.0.0.1:18790'),
        openBridge:async(attemptSignal)=>{coordinator.startRun();const w=new Workbench(files,selection);activeWorkbench=w;return startBridge({workbench:w,signal:attemptSignal,...(python()?{python:python()!}:{}),review:r=>review(w,r,port,attemptSignal,()=>{sideEffects=true;})});},
        onEvent:(timeline,url)=>{sessionUrl=url;latestTimeline=timeline.display().map(e=>`${e.type}${e.tools.length?' '+e.tools.join(', '):''}\n${e.text}`).join('\n');ledger=JSON.stringify(activeWorkbench?.ledger() ?? {},null,2);paint();},
      });
      const result=await failover.run({models,request:`${request}\nAvailable files: ${paths.join(', ')}${selection?`\nInline scope: ${selection.path}, UTF-16 ${selection.span.start}–${selection.span.end}.`:''}`,signal,driver,hasSideEffects:()=>sideEffects,onSwitch:model=>log(`Running via TrueForge: ${model}`)});log(result);
    }finally{
      try{await driver?.abandon();}catch(e){output.appendLine(`Cleanup requires attention: ${String(e)}`);}
      if(baseline){const result=compareInventory(baseline,await inventory(port,paths));log(`${status}. Loaded-file integrity: ${result.paths.length?`changed (${result.paths.join(', ')})`:'unchanged relative to baseline'}; whole-workspace coverage incomplete.`);}
      signal.removeEventListener('abort',cancelCommit);busy=false;controller=undefined;paint(true);
    }
  }
  const register=(name:string,fn:()=>unknown)=>context.subscriptions.push(vscode.commands.registerCommand(name,async()=>{try{await fn();}catch(e){log(e instanceof Error?e.message:String(e));void vscode.window.showErrorMessage(`Milo: ${status}`);}}));
  register('milo.open',show);register('milo.run',()=>run(false));register('milo.inline',()=>run(true));
  register('milo.cancel',()=>{controller?.abort();coordinator.cancel();log('Run cancelled locally; pending writes revoked.');});
  register('milo.undo',async()=>{if(busy)throw new Error('Cancel the active run before undo.');if(!lastPlan||!lastPort)throw new Error('No Milo apply to undo.');coordinator.startRun();const signal=new AbortController().signal;const inverse=inversePlan(lastPlan,await lastPort.read(lastPlan.changes.map(f=>f.path),signal));const result=await coordinator.apply(coordinator.issue(inverse),lastPort);if(result.status==='applied'){lastPlan=undefined;log('Restored exact pre-apply buffer text.');}else throw new Error(`Undo ${result.status}`);});
  register('milo.recover',async()=>{if(!lastPort)throw new Error('No editor recovery context.');log(`Recovery: ${await coordinator.recover(lastPort)}`);});
  register('milo.verify',async()=>{
    if(busy)throw new Error('Finish or cancel the active run first.');
    if(!lastPlan||!lastPort)throw new Error('Apply a Milo plan before verification.');
    if(!vscode.workspace.isTrusted)throw new Error('Verification requires a trusted workspace.');
    const executable=cfg().get<string>('verifyExecutable','');const args=cfg().get<string[]>('verifyArgs',[]);
    if(!executable)throw new Error('Set milo.verifyExecutable and milo.verifyArgs in user settings to a trusted test command. It runs in a disposable copy of the loaded files, without OS sandbox isolation.');
    busy=true;controller=new AbortController();
    try{
      const current=await lastPort.read(lastPaths,controller.signal);
      log(`Verifying ${current.size} loaded files in a disposable copy; external dependencies are not isolated.`);
      const result=await verifySnapshot({files:[...current].map(([path,text])=>({path,text})),plan:lastPlan,executable,args,signal:controller.signal,ledger:verification});
      // An edit during execution invalidates the displayed result, even if the process passed.
      const after=await lastPort.read(lastPaths,new AbortController().signal);
      const fresh=[...current].every(([path,text])=>after.get(path)===text);
      receiptId=fresh?result.receipt.id:undefined;
      output.appendLine(result.output);log(`Verification ${fresh?result.receipt.status:'stale'} for ${current.size} loaded files; exit ${result.exitCode}. Full-project coverage is not asserted.`);
    }finally{busy=false;controller=undefined;}
  });
  register('milo.exportEvidence',async()=>{
    const evidence={product:'Milo AI',version:'0.2.0',exportedAt:new Date().toISOString(),sessionUrl:sessionUrl||null,
      acceptedChanges:lastPlan?.changes.map(f=>({path:f.path,before:digest(f.before),after:digest(f.after)}))??[],
      provenance:ledger?JSON.parse(ledger):{},verificationReceipt:receiptId??null,
      limitations:['Loaded-file inventory only','No OS sandbox for verification commands','No real-model score inferred from scripted tests']};
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(evidence,null,2)}));
  });
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e=>{if(receiptId&&e.contentChanges.length){receiptId=undefined;log('Verification receipt stale after an editor change.');}}));
  context.subscriptions.push({dispose:()=>{controller?.abort();coordinator.cancel();panel?.dispose();}});
}
