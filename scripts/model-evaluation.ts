// Real TrueForge sessions over immutable public Flask snapshots. No checkout/editor writes.
import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {createServer} from 'node:net';import {randomUUID} from 'node:crypto';
import {captureRepository,SymbolIndex} from '../src/core/repository.js';import {analyzePython} from '../src/core/python-analysis.js';import {Workbench} from '../src/core/workbench.js';import {startBridge} from '../src/bridge/mcp.js';import {TrueForgeDriver} from '../src/bridge/trueforge.js';import {ModelFailover} from '../src/core/failover.js';import {verifySnapshot} from '../src/core/verify-runner.js';import {VerificationLedger} from '../src/core/verification.js';import {runProcess} from '../src/core/process.js';import {requirements} from '../src/core/review-quality.js';import type {CommitPlan} from '../src/core/change-batch.js';import {TASK_A,TASK_B,CHECK_A,CHECK_B,summarize,safeError} from './eval-cases.js';
async function main(){
 const stop=new AbortController();process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
 const root=resolve(process.argv[2]??'');const output=process.env.MILO_EVAL_OUTPUT??'test-results/model-evaluation.json';await mkdir('test-results',{recursive:true});
 const models:unknown=JSON.parse(process.env.MILO_EVAL_MODELS??'[]');if(!Array.isArray(models)||models.length!==2||models.some(m=>typeof m!=='string'||!m)||models[0]===models[1])throw new Error('Two distinct configured models required');
 if(!process.argv.includes('--run'))throw new Error('Pass --run; use only providers within your authorized quota/budget');
 const tasks=(process.env.MILO_EVAL_TASKS??'A,B,C').split(',');if(tasks.some(t=>!['A','B','C'].includes(t)))throw new Error('Tasks must be A,B,C');
 const aRepeats=Number(process.env.MILO_EVAL_REPEATS??10),bRepeats=Number(process.env.MILO_EVAL_B_REPEATS??5),cRepeats=Number(process.env.MILO_EVAL_C_REPEATS??3);if([aRepeats,bRepeats,cRepeats].some(n=>!Number.isInteger(n)||n<1||n>10))throw new Error('Use 1–10 repeats');
 const head=await runProcess({executable:'git',args:['-C',root,'rev-parse','HEAD']});if(head.output.trim()!=='22d924701a6ae2e4cd01e9a15bbaf3946094af65')throw new Error('Use pinned Flask 3.1.3');
 const clean=await runProcess({executable:'git',args:['-C',root,'status','--porcelain']});if(clean.exitCode||clean.output.trim())throw new Error('Use a clean disposable checkout');
 const fixtures=new Set(['tests/test_apps/.env']);const capture=()=>captureRepository(root,new Map(),undefined,fixtures);const tree=await capture();if(!tree.complete)throw new Error('Incomplete snapshot');
 const python=process.env.MILO_PYTHON??(process.platform==='win32'?'python':'python3');const baseUrl=process.env.TRUEFORGE_BASE_URL??'http://127.0.0.1:18790';const origin=new URL(baseUrl);if(origin.protocol!=='http:'||!['127.0.0.1','localhost'].includes(origin.hostname))throw new Error('Use local TrueForge');
 const target=tree.files.find(f=>f.path==='src/flask/helpers.py')!;const text=Buffer.from(target.bytes).toString('utf8');const fn=(await analyzePython(text,{python})).nodes?.find(n=>n.name==='get_debug_flag');if(!fn)throw new Error('Python site unavailable');
 const snapshots=new Map<string,string>(),index=new SymbolIndex();for(const f of tree.files){try{if(f.bytes.length<=1_000_000){const s=new TextDecoder('utf8',{fatal:true}).decode(f.bytes);snapshots.set(f.path,s);index.update(f.path,s);}}catch{}}
 const seed=[...snapshots].filter(([path])=>/\.(py|rst|md|toml|txt|json|yaml|yml|cfg|ini)$/.test(path)).map(([path,text])=>({path,text}));
 const settings=async(method:string,suffix:string,body?:unknown)=>{const r=await fetch(`${baseUrl}/api/v1/settings/model-providers${suffix}`,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`Test provider settings HTTP ${r.status}`);};
 const invalid=`milo-eval-invalid-${randomUUID()}`,closed=`milo-eval-closed-${randomUUID()}`;const created:string[]=[];
 const rows:Record<string,unknown>[]=[];const skipped:Record<string,unknown>[]=[];const blocked=new Set<string>(JSON.parse(process.env.MILO_EVAL_BLOCKED_MODELS??'[]'));
 const schedule:{task:string;model:string;iteration:number;failure?:string}[]=[];
 // Interleave first A/B/C observations before spending the remaining daily quota on repeats.
 for(let iteration=1;iteration<=Math.max(aRepeats,bRepeats,cRepeats);iteration++){
  for(const model of models as string[]){if(tasks.includes('A')&&iteration<=aRepeats)schedule.push({task:'A',model,iteration});if(tasks.includes('B')&&iteration<=bRepeats)schedule.push({task:'B',model,iteration});}
  if(tasks.includes('C')&&iteration<=cRepeats)for(const failure of ['invalid-key','closed-port'])schedule.push({task:'C',model:(process.env.MILO_EVAL_FALLBACK_MODEL??models[(iteration-1)%2]) as string,iteration,failure});
 }
 schedule.sort((a,b)=>a.iteration-b.iteration||tasks.indexOf(a.task)-tasks.indexOf(b.task));
 const save=async(status:string)=>{const summary=summarize(rows);await writeFile(output,JSON.stringify({status,pin:head.output.trim(),scope:'Offline production-service checks; native diff rendering and physical keys not measured here. Task A docstrings still require review.',requested:schedule.length,summary,skipped,rows},null,2));await writeFile(output.replace(/\.json$/,'.md'),`| Task/model | Passed/attempted | Median review ms | Median failover ms | Quota-blocked |\n|---|---:|---:|---:|---:|\n${summary.map(s=>`| ${s.group} | ${s.passed}/${s.attempted} | ${s.medianReviewMs??'—'} | ${s.medianFailoverMs??'—'} | ${s.quotaBlocked} |`).join('\n')}\n\n${skipped.length} scheduled runs not attempted. Offline semantic checks are not complete rubric scores.\n`);};
 try{
  if(tasks.includes('C')){
   await settings('POST','',{manifest:{type:'custom',name:invalid,auth:{api_key:'deliberately-invalid-milo-key'},base_url:'https://generativelanguage.googleapis.com/v1beta/openai',models:[{name:'failure',model_id:'gemini-3.5-flash',properties:{context_length:32000}}]}});created.push(invalid);
   const portServer=createServer();await new Promise<void>(r=>portServer.listen(0,'127.0.0.1',r));const addr=portServer.address();if(!addr||typeof addr==='string')throw new Error('Missing test port');await new Promise<void>(r=>portServer.close(()=>r()));
   await settings('POST','',{manifest:{type:'custom',name:closed,auth:{api_key:'no-live-key'},base_url:`http://127.0.0.1:${addr.port}/v1`,models:[{name:'failure',model_id:'failure',properties:{context_length:32000}}]}});created.push(closed);
  }
  for(const item of schedule){if(stop.signal.aborted)break;
   if(blocked.has(item.model)){skipped.push({...item,reason:'Model quota blocked in an earlier attempt'});continue;}
   const started=Date.now();const signal=AbortSignal.any([stop.signal,AbortSignal.timeout(10*60*1000)]);let work:Workbench|undefined,plan:CommitPlan|undefined,diffMs:number|undefined,session='';const switches:{model:string;ms:number}[]=[];
   const row:Record<string,unknown>={...item,status:'failed',diffRendered:null,rendering:'Offline runner; native rendering unmeasured',guardrails:[]};
   const prompt=item.task==='B'?TASK_B:TASK_A;
   const driver=new TrueForgeDriver({baseUrl,smallModel:true,inline:item.task!=='B',onEvent:(_t,url)=>{session=url;},openBridge:async s=>{
    const w=new Workbench(item.task==='B'?seed:[{path:target.path,text}],item.task==='B'?undefined:{path:target.path,span:{start:fn.start,end:fn.end}});work=w;
    return startBridge({workbench:w,signal:s,python,smallModel:true,request:prompt,...(item.task==='B'?{catalog:{paths:[...snapshots.keys()],findSymbol:s=>index.find(s),read:async path=>{const text=snapshots.get(path);if(text===undefined)throw new Error('Unindexed path');return {path,text};}}}:{}),review:async r=>{diffMs=Date.now()-started;row.diffPrepared=r.proposals.length>0;row.checklist=requirements(prompt,w.changes());row.changes=w.changes();if(item.task==='C'){w.cancel();return {status:'declined for resilience check; no write accepted'};}plan=w.accept(r.proposals.map(p=>p.id),new Map(w.changes().map(f=>[f.path,f.before])));return {status:'offline snapshot accepted; checkout unchanged'};}});
   }});
   try{
    const ordered=item.task==='C'?[`${item.failure==='invalid-key'?invalid:closed}/failure`,item.model]:[item.model];
    await new ModelFailover().run({models:ordered,request:item.task==='B'?prompt:`${prompt}\nSelected function get_debug_flag in ${target.path}, UTF-16 ${fn.start}–${fn.end}.`,signal,driver,hasSideEffects:()=>!!plan,onSwitch:model=>switches.push({model,ms:Date.now()-started})});
    if(item.task==='C'){if(switches.length!==2||!row.diffPrepared)throw new Error('Fallback did not reach a reviewable diff');row.status='passed';row.failoverMs=switches[1]!.ms;}
    else{
     if(!plan?.changes.length)throw new Error('No accepted diff');row.changedPaths=plan.changes.map(f=>f.path);row.filesTouched=plan.changes.length;
     row.syntaxGate=(await Promise.all(plan.changes.filter(f=>f.path.endsWith('.py')).map(f=>analyzePython(f.after,{python,signal})))).every(a=>a.status==='valid');
     if(item.task==='A'){row.scopeStayed=plan.changes.length===1&&plan.changes[0]!.path===target.path&&plan.changes[0]!.after.startsWith(text.slice(0,fn.start))&&plan.changes[0]!.after.endsWith(text.slice(fn.end));if(!row.scopeStayed)throw new Error('Selection scope failed');row.docstringReview='required';}
     if(item.task==='B'&&(plan.changes.length<3||requirements(prompt,plan.changes).some(c=>c.status==='missing')))throw new Error('Three-file/checklist requirement missing');
     const result=await verifySnapshot({files:work!.files(),tree:tree.files,plan,executable:python,args:['-c',item.task==='B'?CHECK_B:CHECK_A],python,importCanary:'flask',signal,ledger:new VerificationLedger(),timeoutMs:120000});
     Object.assign(row,{status:result.receipt.status==='passed'&&row.syntaxGate?'passed':'failed',verification:result.receipt,output:safeError(result.output),dependency:result.dependency,canary:result.canary});
     // Retain actual candidate patches for independent review and replay, not just self-reported success.
     row.changes=plan.changes;
    }
   }catch(e){row.error=safeError(e);if(/Request failed \(429\)|RESOURCE_EXHAUSTED|quota exceeded/i.test(String(row.error))){row.status='quota-blocked';blocked.add(item.model);}row.guardrails=[safeError(e)];row.timeline=driver.timeline.display().map(e=>({type:e.type,tools:e.tools,text:safeError(e.text).slice(-1800)}));}
   finally{try{await driver.abandon();}catch(e){row.cleanup=safeError(e);}Object.assign(row,{session,timeToDiffMs:diffMs??null,elapsedMs:Date.now()-started,switches,provenance:work?.ledger(),usage:driver.timeline.snapshot().filter(e=>e.type==='model.message').map(e=>e.type==='model.message'?e.usage:undefined).filter(Boolean)});rows.push(row);await save('running');console.log(JSON.stringify({task:item.task,model:item.model,iteration:item.iteration,status:row.status,elapsedMs:row.elapsedMs}));}
   if(row.cleanup)throw new Error('Stopped after uncertain cleanup');if((await capture()).fingerprint!==tree.fingerprint)throw new Error('Checkout changed; stopped');
  }
  await save(stop.signal.aborted?'interrupted':skipped.length?'partial-quota-blocked':'completed');
 }finally{for(const name of created)await settings('DELETE',`/${encodeURIComponent(name)}`).catch(()=>{console.error('Temporary failure-provider cleanup requires inspection');});}
}
main().catch(e=>{console.error(safeError(e));process.exitCode=1;});
