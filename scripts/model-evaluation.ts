// Offline acceptance harness: production TrueForge/MCP components, no editor or checkout writes.
// This is not the recorded VS Code demonstration. Every row identifies an actual model/session.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {captureRepository,SymbolIndex} from '../src/core/repository.js';
import {analyzePython} from '../src/core/python-analysis.js';
import {Workbench} from '../src/core/workbench.js';
import {startBridge} from '../src/bridge/mcp.js';
import {TrueForgeDriver} from '../src/bridge/trueforge.js';
import {ModelFailover} from '../src/core/failover.js';
import {verifySnapshot} from '../src/core/verify-runner.js';
import {VerificationLedger} from '../src/core/verification.js';
import {runProcess} from '../src/core/process.js';
import type {CommitPlan} from '../src/core/change-batch.js';

const PROMPT="Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";
const CHECK=String.raw`import os,inspect,json
from flask.helpers import get_debug_flag
cases=[(None,False),('',False),('0',False),('false',False),('FALSE',False),('no',False),('No',False),('off',False),('OFF',False),('n',False),('N',False),('1',True),('yes',True),('true',True),(' off ',True)]
for value,expected in cases:
 if value is None: os.environ.pop('FLASK_DEBUG',None)
 else: os.environ['FLASK_DEBUG']=value
 assert get_debug_flag() is expected,(value,expected)
print(json.dumps({'cases':len(cases),'docstring':inspect.getdoc(get_debug_flag),'note':'Docstring completeness requires review; semantic cases alone do not score the complete task.'}))`;
async function main(){
  const root=resolve(process.argv[2]??'');const output='test-results/model-evaluation.json';await mkdir('test-results',{recursive:true});
  const models:unknown=JSON.parse(process.env.MILO_EVAL_MODELS??'[]');
  if(!Array.isArray(models)||models.length!==2||models.some(m=>typeof m!=='string'||!m)||models[0]===models[1]){
    await writeFile(output,JSON.stringify({status:'blocked',reason:'Configure two distinct real provider/model names in TrueForge and MILO_EVAL_MODELS. No model scores measured.',runs:[]},null,2));throw new Error('Two configured real models required; no provider credentials belong in this script.');
  }
  if(!process.argv.includes('--run'))throw new Error('Pass --run to authorize 10 Task A attempts per configured model (provider usage/cost applies).');
  const head=await runProcess({executable:'git',args:['-C',root,'rev-parse','HEAD']});if(head.output.trim()!=='22d924701a6ae2e4cd01e9a15bbaf3946094af65')throw new Error('Use the pinned Flask 3.1.3 checkout');
  const clean=await runProcess({executable:'git',args:['-C',root,'status','--porcelain']});if(clean.exitCode!==0||clean.output.trim())throw new Error('Evaluation requires a clean disposable Flask checkout');
  const tree=await captureRepository(root);if(!tree.complete)throw new Error('Incomplete Flask snapshot');
  const python=process.env.MILO_PYTHON??(process.platform==='win32'?'python':'python3');
  const baseUrl=process.env.TRUEFORGE_BASE_URL??'http://127.0.0.1:18790';
  const target=tree.files.find(f=>f.path==='src/flask/helpers.py')!;const text=Buffer.from(target.bytes).toString('utf8');
  const fn=(await analyzePython(text,{python})).nodes?.find(n=>n.name==='get_debug_flag');if(!fn)throw new Error('Python function analysis unavailable');
  const index=new SymbolIndex();const snapshots=new Map<string,string>();for(const f of tree.files){try{if(f.bytes.length<=1_000_000){const content=new TextDecoder('utf8',{fatal:true}).decode(f.bytes);snapshots.set(f.path,content);index.update(f.path,content);}}catch{}}
  const rows:Record<string,unknown>[]=[];
  for(const model of models as string[])for(let iteration=1;iteration<=10;iteration++){
    const start=Date.now();let plan:CommitPlan|undefined;let diffMs:number|undefined;let session='';let work:Workbench|undefined;
    const row:Record<string,unknown>={model,iteration,task:'A',status:'failed',prompt:PROMPT};
    const signal=AbortSignal.timeout(10*60*1000);
    const driver=new TrueForgeDriver({baseUrl,smallModel:true,onEvent:(_timeline,url)=>{session=url;},openBridge:async signal=>{
      const w=new Workbench([{path:target.path,text}],{path:target.path,span:{start:fn.start,end:fn.end}});work=w;
      return startBridge({workbench:w,signal,python,smallModel:true,request:PROMPT,catalog:{paths:[...snapshots.keys()],findSymbol:s=>index.find(s),read:async path=>{const text=snapshots.get(path);if(text===undefined)throw new Error('Unindexed path');return {path,text};}},review:async r=>{diffMs=Date.now()-start;plan=w.accept(r.proposals.map(p=>p.id),new Map(w.changes().map(f=>[f.path,f.before])));return {status:'accepted for offline evaluation only; checkout unchanged'};}});
    }});
    try{
      await new ModelFailover().run({models:[model],request:`${PROMPT}\nSelected function: get_debug_flag in ${target.path}, UTF-16 ${fn.start}–${fn.end}.`,signal,driver,hasSideEffects:()=>!!plan,onSwitch:()=>{}});
      if(!plan?.changes.length)throw new Error('No accepted diff');
      const result=await verifySnapshot({files:work!.files(),tree:tree.files,plan,executable:python,args:['-c',CHECK],python,importCanary:'flask',signal,ledger:new VerificationLedger()});
      Object.assign(row,{status:result.receipt.status==='passed'?'semantic-checks-passed-docstring-review-required':'failed',verification:result.receipt,output:result.output,dependency:result.dependency,changedPaths:plan.changes.map(f=>f.path),candidate:plan.changes.map(f=>f.after.slice(fn.start,fn.start+4000))});
    }catch(e){row.error=e instanceof Error?e.message:String(e);}
    finally{try{await driver.abandon();}catch{row.cleanup='requires inspection';}Object.assign(row,{session,timeToDiffMs:diffMs??null,elapsedMs:Date.now()-start,provenance:work?.ledger(),usage:driver.timeline.snapshot().filter(e=>e.type==='model.message').map(e=>e.type==='model.message'?e.usage:undefined).filter(Boolean)});rows.push(row);await writeFile(output,JSON.stringify({status:'running',pin:head.output.trim(),scope:'Offline Task A production-driver evaluation; not an editor video or complete rubric score',rows},null,2));}
    if(row.cleanup)throw new Error('Stopped after incomplete cleanup');
    if((await captureRepository(root)).fingerprint!==tree.fingerprint)throw new Error('Checkout changed during evaluation; stopped');
  }
  await writeFile(output,JSON.stringify({status:'completed',pin:head.output.trim(),scope:'Offline Task A semantic checks; review docstrings, model cost and editor demos separately',rows},null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
