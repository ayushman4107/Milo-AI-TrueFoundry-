// Scripted provider, real TrueForge, production Milo driver/bridge/workbench.
// This proves plumbing and guards, not real-model coding quality.
import assert from 'node:assert/strict';
import { createServer,request as httpRequest } from 'node:http';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { Workbench } from '../src/core/workbench.js';
import { startBridge } from '../src/bridge/mcp.js';
import { TrueForgeDriver } from '../src/bridge/trueforge.js';
import { ModelFailover } from '../src/core/failover.js';
import { CommitCoordinator } from '../src/core/commit-coordinator.js';
import { inversePlan } from '../src/core/change-batch.js';
import {validateWorkOrder} from '../src/core/scout.js';

async function main(){
  const baseUrl=process.env.TRUEFORGE_BASE_URL ?? 'http://127.0.0.1:18790';
  assert(['127.0.0.1','localhost'].includes(new URL(baseUrl).hostname));
  const prefix=`milo-edge-${randomUUID()}`;const token=randomBytes(32).toString('hex');
  const file={path:'cli.py',text:'def inspect_command():\n    return 1\n'};
  const current=new Map([[file.path,file.text]]);const coordinator=new CommitCoordinator();coordinator.startRun();
  let w:Workbench;let step=0;let approvals=0;let stagedRead=false;let finalPlan:ReturnType<Workbench['accept']>|undefined;
  const observed=new Set<string>();const switches:string[]=[];const sessions=new Set<string>();
  const attemptSignals:AbortSignal[]=[];
  let dropped=false;let createdTurns=0;let subscriptions=0;let driverUrl=baseUrl;
  const proxy=createServer((req,res)=>{
    if(req.method==='POST'&&req.url?.endsWith('/turns'))createdTurns++;
    if(req.url?.includes('/subscribe'))subscriptions++;
    const target=new URL(req.url??'/',baseUrl);const upstream=httpRequest(target,{method:req.method,headers:{...req.headers,host:target.host}},response=>{
      res.writeHead(response.statusCode??502,response.headers);res.flushHeaders();let tail='';response.on('data',(chunk:Buffer)=>{tail=(tail+chunk.toString()).slice(-64000);if(!dropped&&/text\/event-stream/.test(String(response.headers['content-type']))&&tail.includes('user.tool_approval')){dropped=true;res.destroy();upstream.destroy();return;}res.write(chunk);});response.on('end',()=>res.end());response.on('error',()=>res.destroy());
    });upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502).end();else res.destroy();});req.pipe(upstream);res.on('close',()=>upstream.destroy());
  });
  if(process.env.MILO_DROP_SSE==='1'){await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));const a=proxy.address();assert(a&&typeof a!=='string');driverUrl=`http://127.0.0.1:${a.port}`;}
  let hit:{id:string};let revision:string;const signal=AbortSignal.timeout(90000);
  function unpack(value:unknown):unknown{
    if(typeof value==='string'){try{return unpack(JSON.parse(value));}catch{return value;}}
    if(Array.isArray(value)&&value[0]?.type==='text')return unpack(value[0].text);
    if(value&&typeof value==='object'&&'content' in value)return unpack(value.content);
    return value;
  }
  const provider=createServer(async(req,res)=>{
    try{
      assert.equal(req.headers.authorization,`Bearer ${token}`);
      const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());
      if(body.model==='bad'){res.writeHead(401,{'content-type':'application/json'}).end(JSON.stringify({error:{message:'Synthetic invalid credential',type:'authentication_error'}}));return;}
      const messages=body.messages.filter((m:{role:string})=>m.role==='tool');const last=unpack(messages.at(-1)?.content);
      const tools=body.tools.map((t:{function:{name:string}})=>t.function.name);
      const scoutMode=body.messages.some((m:{content:unknown})=>typeof m.content==='string'&&m.content.includes('You are Milo Scout'));
      let name='';let args:Record<string,unknown>={};let completion='Synthetic workflow complete.';
      if(scoutMode){assert(!tools.includes('stage_edit'));assert(!tools.includes('submit_for_review'));
        if(messages.length===0){name='trace_exemplar';args={symbol:'inspect_command'};}
        else if(messages.length===1){const h=(last as {id:string}[])[0]!;name='read_evidence';args={discovery_id:h.id,path:file.path,start_line:1,end_line:2};}
        else completion=JSON.stringify([{path:file.path,startLine:1,endLine:2,reason:'Implementation read through Scout capability'}]);
      }else{
      if(step===0){name='trace_exemplar';args={symbol:'inspect_command'};}
      if(step===1){hit=(last as {id:string}[])[0]!;assert(hit.id);name='read_evidence';args={discovery_id:hit.id,path:file.path,start_line:1,end_line:2};}
      if(step===2){revision=(last as {revision:string}).revision;assert(revision);name='stage_edit';const start=file.text.indexOf('1');args={path:file.path,revision,span:{start,end:start+1},expected:'1',replacement:'2'};}
      if(step===3){name='trace_exemplar';args={symbol:'inspect_command'};}
      if(step===4){hit=(last as {id:string}[])[0]!;name='read_evidence';args={discovery_id:hit.id,path:file.path,start_line:1,end_line:2};}
      if(step===5){assert((last as {text:string}).text.includes('return 2'));stagedRead=true;name='pack_context';args={budget_bytes:1000};}
      if(step===6){assert((last as {bytes:number}).bytes<=1000);name='submit_for_review';}
      if(step===7)assert.equal((last as {status:string}).status,'applied',JSON.stringify(last));
      step++;}
      if(name)assert(tools.includes(name),`Tool ${name} absent`);
      const delta=name?{tool_calls:[{index:0,id:`call_${randomUUID()}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{content:completion};
      const chunk=(d:unknown,finish_reason:string|null=null)=>({id:'edge-script',object:'chat.completion.chunk',created:1,model:'good',choices:[{index:0,delta:d,finish_reason}]});
      res.writeHead(200,{'content-type':'text/event-stream'});res.write(`data: ${JSON.stringify(chunk({role:'assistant',...delta}))}\n\n`);res.write(`data: ${JSON.stringify(chunk({},name?'tool_calls':'stop'))}\n\n`);res.end('data: [DONE]\n\n');
    }catch(e){res.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({error:{message:String(e)}}));}
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));const address=provider.address();assert(address&&typeof address!=='string');
  const api=async(path:string,method:string,body?:unknown)=>{const r=await fetch(`${baseUrl}/api/v1/settings/model-providers${path}`,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});assert(r.ok,`Settings ${r.status}`);};
  const port={read:async()=>new Map(current),compareAndSwap:async(plan:NonNullable<typeof finalPlan>)=>{if(plan.changes.some(f=>current.get(f.path)!==f.before))return 'rejected' as const;for(const f of plan.changes)current.set(f.path,f.after);return 'applied' as const;}};
  const driver=new TrueForgeDriver({baseUrl:driverUrl,openBridge:async s=>{if(attemptSignals.length)assert(attemptSignals.at(-1)!.aborted,'Old attempt must be revoked before fallback');attemptSignals.push(s);w=new Workbench([file]);return startBridge({workbench:w,signal:s,review:async r=>{approvals++;finalPlan=w.accept(r.proposals.map(p=>p.id),current);return coordinator.apply(coordinator.issue(finalPlan),port);}});},onEvent:(timeline,url)=>{sessions.add(url.replace(driverUrl,baseUrl));for(const e of timeline.snapshot())observed.add(e.type);}});
  const scoutWorkbench=new Workbench([file]);const scoutSessions:string[]=[];
  const scout=new TrueForgeDriver({baseUrl,mode:'scout',openBridge:s=>startBridge({workbench:scoutWorkbench,signal:s,readOnly:true,review:async()=>{throw new Error('Scout cannot review');}}),onEvent:(_t,url)=>{if(!scoutSessions.includes(url))scoutSessions.push(url);}});
  try{
    await api('','POST',{manifest:{type:'custom',name:prefix,auth:{api_key:token},base_url:`http://127.0.0.1:${address.port}/v1`,models:[{name:'bad',model_id:'bad',properties:{context_length:32000}},{name:'good',model_id:'good',properties:{context_length:32000}}]}});
    const order=validateWorkOrder(await scout.attempt(`${prefix}/good`,'Read the command implementation and return a work order.',signal),scoutWorkbench);assert.equal(order.length,1);assert.equal(scoutWorkbench.changedFiles().length,0);await scout.abandon();
    await new ModelFailover().run({models:[`${prefix}/bad`,`${prefix}/good`],request:'Change inspect_command to return 2 and review.',signal,driver,hasSideEffects:()=>approvals>0,onSwitch:m=>switches.push(m.split('/').at(-1)!)});
    assert.deepEqual(switches,['bad','good']);assert.equal(approvals,1);assert(stagedRead);assert(current.get(file.path)!.includes('return 2'));assert(observed.has('tool.approval_required'));
    assert(finalPlan);const undo=inversePlan(finalPlan,current);assert.equal((await coordinator.apply(coordinator.issue(undo),port)).status,'applied');assert.equal(current.get(file.path),file.text);
    if(process.env.MILO_DROP_SSE==='1'){assert(dropped,'Proxy never dropped an approval stream');assert.equal(createdTurns,2,'Reconnect created an extra turn');assert(subscriptions>=2);}
    const report={kind:'production-milo-components-scripted-provider-real-trueforge',status:'passed',checks:['separate read-only Scout session and evidence-bound handoff','provider 401 failover','old bridge revoked before fallback','trace and revision-bound read','stage then reread overlay','bounded context','same-turn approval','one local review','apply','exact undo'],switches,approvals,events:[...observed],sessions:[...sessions],scoutSessions,faultInjection:{dropped,createdTurns,subscriptions}};
    await mkdir('test-results',{recursive:true});await writeFile(`test-results/${dropped?'reconnect':'edge'}-contract.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{provider.closeAllConnections();await new Promise<void>(resolve=>provider.close(()=>resolve()));await Promise.allSettled([driver.abandon(),scout.abandon(),api(`/${prefix}`,'DELETE')]);proxy.closeAllConnections();if(proxy.listening)await new Promise<void>(resolve=>proxy.close(()=>resolve()));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
