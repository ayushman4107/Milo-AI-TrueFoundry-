import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { relative } from 'node:path';
import { EditorPort } from './editor/adapter.js';
import { Workbench } from './core/workbench.js';
import { CommitCoordinator } from './core/commit-coordinator.js';
import { digest, inversePlan, type CommitPlan, type Snapshot } from './core/change-batch.js';
import { checkPython } from './core/python-syntax.js';
import { ModelFailover } from './core/failover.js';
import { startBridge, type Review } from './bridge/mcp.js';
import { TrueForgeDriver } from './bridge/trueforge.js';
import { verifySnapshot,verifyDifferential } from './core/verify-runner.js';
import { VerificationLedger } from './core/verification.js';
import { captureRepository,SymbolIndex,type RepositorySnapshot } from './core/repository.js';
import { SaveJournal } from './core/journal.js';
import { analyzePython,enclosingNode } from './core/python-analysis.js';
import { requirements,reviewQuality,rebaseChange } from './core/review-quality.js';
import { keyboardReview,reviewCommand,reviewSnapshot } from './editor/review.js';
import { setupDoctor } from './bridge/doctor.js';
import { validateWorkOrder } from './core/scout.js';
import { TokenEstimate } from './core/model-profile.js';

const escape = (value:string) => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function activate(context:vscode.ExtensionContext) {
  const output=vscode.window.createOutputChannel('Milo AI');context.subscriptions.push(output);
  const coordinator=new CommitCoordinator();const failover=new ModelFailover();
  let controller:AbortController|undefined;let busy=false;let lastPlan:CommitPlan|undefined;let lastPort:EditorPort|undefined;
  let lastPaths:string[]=[];let receiptId:string|undefined;const verification=new VerificationLedger();
  let lastVerification:unknown;
  let recoveryCandidate:{plan:CommitPlan;port:EditorPort;paths:string[];sessionUrl:string}|undefined;
  let acceptedSessionUrl='';
  const index=new SymbolIndex();const tokenEstimate=new TokenEstimate();const usageSeen=new Set<string>();let currentModel='';let activity='Idle';let checklistText='';let scoutSessionUrl='';
  let indexAllowed=new Set<string>();
  let previousRequest='';let currentRequest='';let lastRoot='';let lastTree:RepositorySnapshot|undefined;
  const buffers=(root:string)=>new Map(vscode.workspace.textDocuments.filter(d=>d.uri.scheme==='file'&&d.isDirty).map(d=>[relative(root,d.uri.fsPath).replaceAll('\\','/'),d.getText()] as const).filter(([p])=>p&&!p.startsWith('../')&&!p.includes(':')));
  let panel:vscode.WebviewPanel|undefined;let sessionUrl='';let latestTimeline='';let ledger='';let status='Ready';let lastPaint=0;
  let lastEditor=vscode.window.activeTextEditor;
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor=>{if(editor?.document.uri.scheme==='file')lastEditor=editor;}));
  const previews=new Map<string,string>();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('milo-preview',{provideTextDocumentContent:uri=>previews.get(uri.toString())??'Preview expired'}));
  const paint=(force=false)=>{
    if(!panel || (!force && Date.now()-lastPaint<250))return;lastPaint=Date.now();
    const nonce=randomBytes(16).toString('hex');
    const estimate=tokenEstimate.estimate(currentModel,ledger);
    panel.webview.html=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';"><style nonce="${nonce}">body{font:14px var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;max-width:1000px}h1{font-size:30px}p{line-height:1.7}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:var(--vscode-textCodeBlock-background)}.tag{padding:8px;border:1px solid var(--vscode-panel-border)}a{color:var(--vscode-textLink-foreground)}</style></head><body><h1>Milo AI</h1><p class="tag">${escape(status)}</p><p><a role="button" href="command:milo.run">Run task</a> · <a role="button" href="command:milo.inline">Edit selection</a> · <a role="button" href="command:milo.cancel">Cancel run</a> · <a role="button" href="command:milo.undo">Undo last apply</a></p><p>Changes remain in a shadow copy until you review individual hunks. All actions are also in the Command Palette.</p>${sessionUrl?`<p><a href="${escape(sessionUrl)}">Open this TrueForge session</a></p>`:''}<h2>Activity</h2><p>${escape(activity)}</p><p>${escape(currentModel)} · ≈ ${estimate.approxTokens} tokens for displayed ledger (${escape(estimate.calibration)})</p>${scoutSessionUrl?`<p><a href="${escape(scoutSessionUrl)}">Scout session</a></p>`:""}<h2>Requirement evidence</h2><pre>${escape(checklistText||"Not evaluated yet.")}</pre><h2>Harness timeline</h2><pre>${escape(latestTimeline||'No model turn yet.')}</pre><h2>Context evidence</h2><pre>${escape(ledger||'No code exposed yet.')}</pre></body></html>`;
  };
  const show=()=>{if(!panel){panel=vscode.window.createWebviewPanel('milo','Milo AI',vscode.ViewColumn.Beside,{enableScripts:false,enableCommandUris:['milo.run','milo.inline','milo.cancel','milo.undo']});panel.onDidDispose(()=>{panel=undefined;});}else panel.reveal();paint(true);};
  const log=(message:string)=>{status=message;output.appendLine(message);paint(true);};
  const cfg=()=>vscode.workspace.getConfiguration('milo');
  const python=()=>cfg().get<string>('pythonExecutable') || undefined;
  const syntax=async(plan:CommitPlan,signal:AbortSignal)=>{
    for(const f of plan.changes.filter(f=>f.path.endsWith('.py'))){const result=await checkPython(f.after,{signal,...(python()?{executable:python()!}:{})});signal.throwIfAborted();if(result.status!=='valid')throw new Error(`${f.path}: ${result.message}`);}
  };
  const review=async(w:Workbench,r:Review,port:EditorPort,signal:AbortSignal,onCommit:()=>void)=>{
    signal.throwIfAborted();log(`Review ready: ${r.proposals.length} hunks. Nothing applied.`);
    const source=new Map(w.files().map(f=>[f.path,f.text]));
    const changes=w.changes();const checks=requirements(currentRequest,changes);const quality=await reviewQuality(changes,{signal,...(python()?{python:python()!}:{}),repoNames:index.names()});
    checklistText=checks.map(c=>`${c.status}: ${c.label}. ${c.explanation}`).join('\n');paint(true);
    const items=r.proposals.map(p=>{const q=quality.find(q=>q.path===p.path)!;return {id:p.id,path:p.path,role:q.role,before:changes.find(f=>f.path===p.path)!.before.slice(p.span.start,p.span.end),after:p.replacement,formattingOnly:q.formattingOnly,warnings:q.warnings,reason:checks.filter(c=>c.paths.includes(p.path)).map(c=>c.label+' (file evidence only)').join('; ')||'Changes previously read code; exact revision and selection checked'};});
    const token=new vscode.CancellationTokenSource();const abort=()=>{token.cancel();coordinator.cancel();};signal.addEventListener('abort',abort,{once:true});
    try{
      for(const path of [...new Set(r.proposals.map(p=>p.path))]){
        signal.throwIfAborted();const uri=vscode.Uri.parse(`milo-preview:/${encodeURIComponent(r.batchId)}/${path}`);previews.set(uri.toString(),source.get(path)!);
        await vscode.commands.executeCommand('vscode.diff',await port.uri(path),uri,`Milo staged: ${path}`,{preview:true});
      }
      const verifyStaged=cfg().get<string>('verifyExecutable','')?async(signal:AbortSignal)=>{
        const tree=await captureRepository(port.root,buffers(port.root),signal,new Set(cfg().get<string[]>('verifyFixturePaths',[])));
        const packages=tree.files.map(f=>/^src\/([A-Za-z_]\w*)\/__init__\.py$/.exec(f.path)?.[1]).filter((s):s is string=>!!s);
        const canary=cfg().get<string>('verifyImport','')||(packages.length===1?packages[0]:undefined);
        const options={files:w.files(),tree:tree.files,plan:{batchId:r.batchId,changes},executable:cfg().get<string>('verifyExecutable',''),args:cfg().get<string[]>('verifyArgs',[]),signal,ledger:verification,python:python()??process.env.MILO_PYTHON??(process.platform==='win32'?'python':'python3'),...(canary?{importCanary:canary}:{})};
        const paired=checks.some(c=>c.id==='tests'&&c.status==='evidence')?await verifyDifferential(options):undefined;
        const result=paired?.patched??await verifySnapshot(options);
        const after=await captureRepository(port.root,buffers(port.root),signal,new Set(cfg().get<string[]>('verifyFixturePaths',[])));
        const fresh=after.fingerprint===tree.fingerprint;
        return `All staged hunks: ${fresh?result.receipt.status:'stale — workspace changed'}. ${tree.files.length} Git-visible files; ${tree.excluded.length} exclusions.\n${paired?`${paired.status}\nBase output:\n${paired.base.output.slice(-3000)}\n${paired.note}\n`:''}Patched output:\n${result.output.slice(-3000)}\nImport: ${result.canary}\nDependencies: ${JSON.stringify(result.dependency)}\nSelecting fewer hunks or rebasing requires verification again after apply.`;
      }:undefined;
      const picked=await keyboardReview(items,checks,signal,verifyStaged);
      signal.throwIfAborted();if(!picked?.length){w.cancel();controller?.abort();return {status:'declined'};}
      const paths=[...new Set(r.proposals.map(p=>p.path))];const current=await port.read(paths,signal);signal.throwIfAborted();
      const accepted=w.accept(picked,new Map(changes.map(f=>[f.path,f.before])));
      const plan={...accepted,changes:accepted.changes.map(f=>rebaseChange(f,current.get(f.path)!))};
      if(plan.changes.some((f,i)=>f.before!==accepted.changes[i]?.before)){const answer=await vscode.window.showWarningMessage('Your edits changed files during review. Milo found unique non-overlapping locations and will preserve those edits.',{modal:true},'Apply rebased hunks');signal.throwIfAborted();if(answer!=='Apply rebased hunks')return {status:'declined'};}
      await syntax(plan,signal);signal.throwIfAborted();
      onCommit();recoveryCandidate={plan,port,paths:w.files().map(f=>f.path),sessionUrl};const result=await coordinator.apply(coordinator.issue(plan),port);
      if(result.status==='applied'||result.status==='applied_after_cancel'){lastPlan=plan;lastPort=port;lastPaths=recoveryCandidate.paths;acceptedSessionUrl=sessionUrl;log(`Applied ${plan.changes.length} files to editor buffers. Python syntax checked; project tests not run. Use Save All to persist.`);}
      else log(`Commit ${result.status}`);
      if(result.status!=='recovery_required')recoveryCandidate=undefined;
      return result;
    }finally{signal.removeEventListener('abort',abort);token.dispose();previews.clear();}
  };
  async function run(inline:boolean,override?:string){
    if(busy)throw new Error('A run is active. Cancel it first.');
    if(!vscode.workspace.isTrusted)throw new Error('Milo requires a trusted workspace.');
    const folder=vscode.workspace.workspaceFolders?.[0];if(!folder||folder.uri.scheme!=='file'||vscode.workspace.workspaceFolders?.length!==1)throw new Error('Open one local workspace (or a VS Code Remote WSL workspace).');
    const editor=vscode.window.activeTextEditor??(lastEditor&&!lastEditor.document.isClosed&&vscode.window.visibleTextEditors.includes(lastEditor)?lastEditor:undefined);
    if(inline&&(!editor||editor.selection.isEmpty))throw new Error('Select the code to edit first.');
    const request=override??await vscode.window.showInputBox({title:inline?'Milo inline edit':'Milo repository task',prompt:'Describe the change. Code is sent through your configured local TrueForge runtime.',ignoreFocusOut:true});if(!request)return;previousRequest=request;currentRequest=request;
    const models=cfg().get<string[]>('models',[]);if(!models.length)throw new Error('Set milo.models to ordered model names already configured in TrueForge.');
    if(busy)throw new Error('Another run started while the input box was open.');
    coordinator.startRun();busy=true;controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15*60*1000)]);const cancelCommit=()=>coordinator.cancel();signal.addEventListener('abort',cancelCommit,{once:true});show();
    let driver:TrueForgeDriver|undefined;let activeWorkbench:Workbench|undefined;let sideEffects=false;const port=new EditorPort(folder.uri.fsPath);let paths:string[]=[];let baselineTree:RepositorySnapshot|undefined;lastRoot=folder.uri.fsPath;
    try{
      baselineTree=await captureRepository(folder.uri.fsPath,buffers(folder.uri.fsPath),signal);lastTree=baselineTree;index.invalidate();
      const catalogFiles=new Map(baselineTree.files.map(f=>[f.path,f]));
      indexAllowed=new Set(catalogFiles.keys());
      const uris=baselineTree.files.filter(f=>/\.(?:py|ts|tsx|js|jsx|json|md|rst|toml|yaml|yml|txt)$/.test(f.path)).map(f=>vscode.Uri.joinPath(folder.uri,...f.path.split('/')));
      for(const f of baselineTree.files){try{if(f.bytes.length<=1_000_000)index.update(f.path,new TextDecoder('utf8',{fatal:true}).decode(f.bytes));}catch{}}
      const catalog={paths:[...catalogFiles.keys()],findSymbol:(symbol:string)=>index.find(symbol),read:async(path:string)=>{if(!catalogFiles.has(path))throw new Error('Path not indexed');const uri=await port.uri(path);const raw=await readFile(uri.fsPath);if(raw.length>1_000_000)throw new Error('File exceeds model context limit');new TextDecoder('utf8',{fatal:true}).decode(raw);return {path,text:(await vscode.workspace.openTextDocument(uri)).getText()};}};
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
      if(!files.length)throw new Error('No supported source files found.');paths=files.map(f=>f.path);
      const selection=selected&&editor?{path:selected,span:{start:editor.document.offsetAt(editor.selection.start),end:editor.document.offsetAt(editor.selection.end)}}:undefined;
      log(`Indexed ${baselineTree.files.length} repository files (${baselineTree.excluded.length} exclusions); ${files.length} loaded into bounded staging context.`);
      const selectedText=selection?files.find(f=>f.path===selection.path)!.text.slice(selection.span.start,selection.span.end):'';
      const selectedIdentifier=/\b(?:def|class|function)\s+([A-Za-z_]\w*)/.exec(selectedText)?.[1];
      let handoff='';const smallModel=cfg().get<boolean>('smallModel',false);
      if(cfg().get<boolean>('scout',false)&&!inline){let scoutWorkbench:Workbench|undefined;const scout=new TrueForgeDriver({baseUrl:cfg().get('trueforgeUrl','http://127.0.0.1:18790'),mode:'scout',smallModel,
        openBridge:async s=>{scoutWorkbench=new Workbench(files);return startBridge({workbench:scoutWorkbench,signal:s,readOnly:true,smallModel,catalog,review:async()=>{throw new Error('Scout cannot review');},onActivity:m=>{activity=`Scout: ${m}`;paint();}});},onEvent:(_t,url)=>{scoutSessionUrl=url;}});
        try{const text=await failover.run({models,request,signal,driver:scout,hasSideEffects:()=>false,onSwitch:m=>log(`Read-only Scout: ${m}`)});handoff=JSON.stringify(validateWorkOrder(text,scoutWorkbench!));}finally{await scout.abandon();}
      }
      driver=new TrueForgeDriver({baseUrl:cfg().get('trueforgeUrl','http://127.0.0.1:18790'),smallModel,inline,
        openBridge:async(attemptSignal)=>{coordinator.startRun();const w=new Workbench(selection?files.filter(f=>f.path===selection.path):files,selection);activeWorkbench=w;return startBridge({workbench:w,signal:attemptSignal,...(inline?{}:{catalog}),smallModel,request,onActivity:m=>{activity=m;paint();},...(python()?{python:python()!}:{}),review:r=>review(w,r,port,attemptSignal,()=>{sideEffects=true;})});},
        onEvent:(timeline,url)=>{sessionUrl=url;for(const e of timeline.snapshot())if(e.type==='model.message'&&e.usage&&!e.reasoningContent&&!e.toolCalls?.length&&typeof e.content==='string'&&!usageSeen.has(e.id)){usageSeen.add(e.id);tokenEstimate.observeOutput(currentModel,e.content,e.usage.outputTokens);}latestTimeline=timeline.display().map(e=>`${e.type}${e.tools.length?' '+e.tools.join(', '):''}\n${e.text}`).join('\n');ledger=JSON.stringify(activeWorkbench?.ledger() ?? {},null,2);paint();},
      });
      const result=await failover.run({models,request:`${request}\nIndexed repository: ${files.length} loaded files.${selection?' Only the selected file is available in inline mode.':' Use list_repository/open_repository_file for the full index.'}${handoff?`\nRead-only Scout work order (advisory, choose your own reads and edits): ${handoff}`:''}${selection?`\nInline scope: ${selection.path}, UTF-16 ${selection.span.start}–${selection.span.end}.${selectedIdentifier?` Selected identifier: ${selectedIdentifier}. Trace this identifier first.`:''}`:''}`,signal,driver,hasSideEffects:()=>sideEffects,onSwitch:model=>{currentModel=model;log(`Running via TrueForge: ${model} (${smallModel?'small':'standard'} preset)`);}});log(result);
    }catch(error){if(signal.aborted){log(controller.signal.aborted?'Run cancelled locally; staged writes revoked.':'Run timed out; staged writes revoked.');return;}throw error;}finally{
      try{await driver?.abandon();}catch(e){output.appendLine(`Cleanup requires attention: ${String(e)}`);}
      if(baselineTree){try{const after=await captureRepository(folder.uri.fsPath,buffers(folder.uri.fsPath));log(`${status}. Git-visible tree: ${after.fingerprint===baselineTree.fingerprint?'unchanged from baseline':'changed'}; exclusions ${after.excluded.length}. Ignored external files are outside coverage.`);}catch(e){output.appendLine(`Integrity unavailable: ${String(e)}`);}}
      signal.removeEventListener('abort',cancelCommit);busy=false;controller=undefined;paint(true);
    }
  }
  const register=(name:string,fn:(...args:unknown[])=>unknown)=>context.subscriptions.push(vscode.commands.registerCommand(name,async(...args:unknown[])=>{try{await startupRecovery;return await fn(...args);}catch(e){log(e instanceof Error?e.message:String(e));void vscode.window.showErrorMessage(`Milo: ${status}`);}}));
  register('milo.open',show);register('milo.run',arg=>run(false,typeof arg==='string'?arg:undefined));register('milo.inline',arg=>run(true,typeof arg==='string'?arg:undefined));
  for(const action of ['next','previous','accept','reject','undoDecision','rejectNoise','confirm','cancel','verify'])register(`milo.review.${action}`,()=>reviewCommand(action));
  register('milo.toggleSmallModel',async()=>{const next=!cfg().get<boolean>('smallModel',false);await cfg().update('smallModel',next,vscode.ConfigurationTarget.Global);log(`${next?'Small':'Standard'} model preset selected for ${cfg().get<string[]>('models',[]).join(', ')||'configured models'}. Applies on the next run.`);});
  register('milo.cancel',()=>{controller?.abort();coordinator.cancel();log('Run cancelled locally; pending writes revoked.');});
  register('milo.undo',async()=>{if(busy)throw new Error('Cancel the active run before undo.');if(!lastPlan||!lastPort)throw new Error('No Milo apply to undo.');coordinator.startRun();const signal=new AbortController().signal;const inverse=inversePlan(lastPlan,await lastPort.read(lastPlan.changes.map(f=>f.path),signal));const result=await coordinator.apply(coordinator.issue(inverse),lastPort);if(result.status==='applied'){lastPlan=undefined;log('Restored exact pre-apply buffer text.');}else throw new Error(`Undo ${result.status}`);});
  register('milo.recover',async()=>{if(busy)throw new Error('Finish or cancel the active run first.');const port=recoveryCandidate?.port??lastPort;if(!port)throw new Error('No editor recovery context.');const result=await coordinator.recover(port);if(result==='applied'&&recoveryCandidate){lastPlan=recoveryCandidate.plan;lastPort=port;lastPaths=recoveryCandidate.paths;acceptedSessionUrl=recoveryCandidate.sessionUrl;}if(result==='applied'||result==='unchanged')recoveryCandidate=undefined;log(`Recovery: ${result}`);});
  const verify=async(differential=false)=>{
    if(busy)throw new Error('Finish or cancel the active run first.');
    if(!lastPlan||!lastPort)throw new Error('Apply a Milo plan before verification.');
    if(!vscode.workspace.isTrusted)throw new Error('Verification requires a trusted workspace.');
    const executable=cfg().get<string>('verifyExecutable','');const args=cfg().get<string[]>('verifyArgs',[]);
    if(!executable)throw new Error('Set milo.verifyExecutable and milo.verifyArgs in user settings to a trusted test command. It runs in a disposable Git-visible snapshot, without OS sandbox isolation.');
    busy=true;controller=new AbortController();
    try{
      const current=await lastPort.read(lastPaths,controller.signal);
      const tree=await captureRepository(lastPort.root,buffers(lastPort.root),controller.signal,new Set(cfg().get<string[]>('verifyFixturePaths',[])));
      const packages=tree.files.map(f=>/^src\/([A-Za-z_]\w*)\/__init__\.py$/.exec(f.path)?.[1]).filter((s):s is string=>!!s);
      const canary=cfg().get<string>('verifyImport','')||(packages.length===1?packages[0]:undefined);
      const py=python()??process.env.MILO_PYTHON??(process.platform==='win32'?'python':'python3');
      log(`Verifying ${tree.files.length} Git-visible files (${tree.excluded.length} exclusions); trusted command with process-tree cleanup.`);
      const options={files:[...current].map(([path,text])=>({path,text})),tree:tree.files,plan:lastPlan,executable,args,signal:controller.signal,ledger:verification,...(tree.files.some(f=>f.path.endsWith('.py'))?{python:py}:{}),...(canary?{importCanary:canary}:{})};
      const paired=differential?await verifyDifferential(options):undefined;
      const result=paired?.patched??await verifySnapshot(options);
      if(paired)output.appendLine(`Differential: ${paired.status}\nBase output: ${paired.base.output}\n${paired.note}`);
      // An edit during execution invalidates the displayed result, even if the process passed.
      const after=await lastPort.read(lastPaths,new AbortController().signal);
      const afterTree=await captureRepository(lastPort.root,buffers(lastPort.root),undefined,new Set(cfg().get<string[]>('verifyFixturePaths',[])));
      const fresh=[...current].every(([path,text])=>after.get(path)===text)&&tree.fingerprint===afterTree.fingerprint;
      receiptId=fresh?result.receipt.id:undefined;
      lastVerification={receipt:result.receipt,input:result.input,dependency:result.dependency,canary:result.canary,exitCode:result.exitCode,treeFiles:result.treeFiles,exclusions:tree.excluded,...(paired?{differential:{status:paired.status,note:paired.note,baseReceipt:paired.base.receipt,baseInput:paired.base.input,baseExitCode:paired.base.exitCode}}:{})};
      output.appendLine(`${result.output}\nImport canary: ${result.canary}\nDependency fingerprint: ${JSON.stringify(result.dependency)}`);log(`Verification ${fresh?result.receipt.status:'stale'} for ${tree.files.length} Git-visible files (${tree.excluded.length} excluded); exit ${result.exitCode}${paired?`; ${paired.status}`:''}.`);
    }finally{busy=false;controller=undefined;}
  };
  register('milo.verify',()=>verify());register('milo.verifyDifferential',()=>verify(true));
  register('milo.doctor',async()=>{const checks=await setupDoctor({baseUrl:cfg().get('trueforgeUrl','http://127.0.0.1:18790'),models:cfg().get('models',[]),python:python()??process.env.MILO_PYTHON??(process.platform==='win32'?'python':'python3'),...(vscode.workspace.workspaceFolders?.[0]?{root:vscode.workspace.workspaceFolders[0].uri.fsPath}:{})});await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({language:'markdown',content:'# Milo setup doctor\n\n'+checks.map(c=>`- ${c.status.toUpperCase()} — ${c.name}: ${c.detail}\n  Fix: ${c.fix}`).join('\n\n')}));});
  register('milo.retry',async()=>{if(busy)throw new Error('Cancel the active run first.');if(!previousRequest)throw new Error('No task to retry.');const note=await vscode.window.showInputBox({title:'Milo: retry with a note',prompt:'Previous context stays visible. A fresh attempt gets current file revisions.'});if(note!==undefined)await run(false,`${previousRequest}\nUser steering: ${note}`);});
  register('milo.expandSelection',async()=>{const editor=vscode.window.activeTextEditor;if(!editor||editor.document.languageId!=='python')throw new Error('Open a Python selection.');const analysis=await analyzePython(editor.document.getText(),{...(python()?{python:python()!}:{})});const node=enclosingNode(analysis,editor.document.offsetAt(editor.selection.start),editor.document.offsetAt(editor.selection.end));if(!node)throw new Error('No enclosing function or class found.');editor.selection=new vscode.Selection(editor.document.positionAt(node.start),editor.document.positionAt(node.end));editor.revealRange(editor.selection);log(`Expanded selection to ${node.name}`);});
  register('milo.saveJournal',async()=>{if(busy||!lastPlan||!lastPort)throw new Error('Finish the run and apply a plan before journaled save.');busy=true;controller=new AbortController();try{const current=await lastPort.read(lastPlan.changes.map(f=>f.path),controller.signal);if(lastPlan.changes.some(f=>current.get(f.path)!==f.after))throw new Error('Buffers changed after apply; refusing to save stale snapshots.');const journal=new SaveJournal(context.globalStorageUri.fsPath,lastPort.root);const result=await journal.save(lastPlan,{signal:controller.signal});log(`Journaled disk save ${result.status}; transaction retained for recovery. Subsequent buffer edits remain unsaved.`);}finally{busy=false;controller=undefined;}});
  register('milo.exportEvidence',async()=>{
    const evidence={product:'Milo AI',version:'0.3.0',exportedAt:new Date().toISOString(),sessionUrl:sessionUrl||null,acceptedSessionUrl:acceptedSessionUrl||null,
      acceptedChanges:lastPlan?.changes.map(f=>({path:f.path,before:digest(f.before),after:digest(f.after)}))??[],
      provenance:ledger?JSON.parse(ledger):{},verificationReceipt:receiptId??null,verification:lastVerification??null,verificationCurrent:!!receiptId,
      scoutSessionUrl:scoutSessionUrl||null,requirements:checklistText,treeCoverage:lastTree?{files:lastTree.files.length,excluded:lastTree.excluded,fingerprint:lastTree.fingerprint}:null,
      limitations:['Git-visible inventory excludes ignored files','Trusted command hardening is not an OS sandbox','No real-model score inferred from scripted tests']};
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(evidence,null,2)}));
  });
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e=>{if(receiptId&&e.contentChanges.length){receiptId=undefined;log('Verification receipt stale after an editor change.');}}));
  const watcher=vscode.workspace.createFileSystemWatcher('**/*');const invalidate=(uri:vscode.Uri)=>{receiptId=undefined;const folder=vscode.workspace.getWorkspaceFolder(uri);if(!folder)return;const path=relative(folder.uri.fsPath,uri.fsPath).replaceAll('\\','/');index.invalidate(path);if(!indexAllowed.has(path))return;void new EditorPort(folder.uri.fsPath).uri(path).then(async safe=>{const bytes=await readFile(safe.fsPath);if(bytes.length<=1_000_000)index.update(path,new TextDecoder('utf8',{fatal:true}).decode(bytes));}).catch(()=>{});};context.subscriptions.push(watcher,watcher.onDidChange(invalidate),watcher.onDidCreate(invalidate),watcher.onDidDelete(invalidate));
  const startupRecovery=Promise.all((vscode.workspace.workspaceFolders??[]).filter(folder=>folder.uri.scheme==='file'&&vscode.workspace.isTrusted).map(async folder=>{try{const results=await new SaveJournal(context.globalStorageUri.fsPath,folder.uri.fsPath).recover(()=>new Set(buffers(folder.uri.fsPath).keys()));if(results.length)log(`Journal recovery: ${JSON.stringify(results)}. Conflicting files were preserved.`);}catch(e){output.appendLine(`Journal recovery requires inspection: ${String(e)}`);}}));
  context.subscriptions.push({dispose:()=>{controller?.abort();coordinator.cancel();panel?.dispose();}});
  return {snapshot:()=>({busy,status,review:reviewSnapshot(),appliedPaths:lastPlan?.changes.map(f=>f.path)??[]})};
}
