import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startBridge } from '../src/bridge/mcp.js';
import { Workbench } from '../src/core/workbench.js';
import { Timeline } from '../src/bridge/timeline.js';
import { terminalFailure } from '../src/bridge/trueforge.js';
import { validateWorkOrder } from '../src/core/scout.js';

test('real MCP transport exposes staged reads, budgets and exactly one host-reviewed plan',async()=>{
  const file={path:'src/action.js',text:'function action() { return 1; }\n'};const w=new Workbench([file]);const controller=new AbortController();let approvals=0;
  const bridge=await startBridge({workbench:w,signal:controller.signal,review:async r=>{approvals++;const plan=w.accept(r.proposals.map(p=>p.id),new Map([[file.path,file.text]]));return {status:'reviewed',after:plan.changes[0]!.after};}});
  const client=new Client({name:'milo-test',version:'1'});const transport=new StreamableHTTPClientTransport(new URL(bridge.url),{requestInit:{headers:{Authorization:`Bearer ${bridge.token}`}}});
  try{
    assert.equal((await fetch(bridge.url,{method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(bridge.url,{method:'POST',headers:{Authorization:`Bearer ${bridge.token}`,Origin:'https://evil.example'},body:'{}'})).status,403);
    const rebindingStatus=await new Promise<number|undefined>((resolve,reject)=>{const req=request(bridge.url,{method:'POST',headers:{Authorization:`Bearer ${bridge.token}`,Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end('{}');});
    assert.equal(rebindingStatus,403);
    await client.connect(transport);const tools=await client.listTools();assert.deepEqual(tools.tools.map(t=>t.name).sort(),['inspect_python_site','pack_context','read_evidence','stage_edit','submit_for_review','trace_exemplar']);
    async function call(name:string,args:Record<string,unknown>){const result=await client.callTool({name,arguments:args});assert(!result.isError,JSON.stringify(result));const content=result.content as {type:string;text:string}[];return JSON.parse(content[0]!.text);}
    const hits=await call('trace_exemplar',{symbol:'action'});const read=await call('read_evidence',{discovery_id:hits[0].id,path:file.path,start_line:1,end_line:1});
    const start=file.text.indexOf('1');await call('stage_edit',{path:file.path,revision:read.revision,span:{start,end:start+1},expected:'1',replacement:'2'});
    const stale=await client.callTool({name:'read_evidence',arguments:{discovery_id:hits[0].id,path:file.path,start_line:1,end_line:1}});assert.equal(stale.isError,true);
    const hits2=await call('trace_exemplar',{symbol:'action'});const reread=await call('read_evidence',{discovery_id:hits2[0].id,path:file.path,start_line:1,end_line:1});assert(reread.text.includes('return 2'));
    const pack=await call('pack_context',{budget_bytes:250});assert(pack.bytes<=250);assert(w.ledger().context.length>0);
    const result=await call('submit_for_review',{});assert.equal(result.after,'function action() { return 2; }\n');assert.equal(approvals,1);
    assert.equal((await client.callTool({name:'submit_for_review',arguments:{}})).isError,true);assert.equal(approvals,1);
  }finally{await client.close();await bridge.close();}
});
test('malformed tool input cannot stage and cancellation revokes a live MCP endpoint',async()=>{
  const c=new AbortController();const w=new Workbench([{path:'a.js',text:'function a() {}'}]);const b=await startBridge({workbench:w,signal:c.signal,review:async()=>{throw new Error('must not review');}});
  const client=new Client({name:'test',version:'1'});
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL(b.url),{requestInit:{headers:{Authorization:`Bearer ${b.token}`}}}));
    const result=await client.callTool({name:'stage_edit',arguments:{path:'../../escape',revision:'invented',span:{start:-1,end:2},expected:'a',replacement:'x'}});assert(result.isError);
    c.abort();assert.throws(()=>w.trace('a'));await assert.rejects(client.listTools());
  }finally{await client.close();await b.close();}
});
test('timeline preserves shared-ID deltas and replay does not duplicate text',()=>{
  const t=new Timeline();const shell={type:'model.message' as const,id:'01',threadId:'main',createdAt:'2026-11-14T00:00:00Z',content:''};
  const delta={type:'model.message.delta' as const,id:'01',threadId:'main',content:'hello'};
  t.add(shell);t.add(delta);t.add({...delta,content:' world'});assert.equal(t.display()[0]!.text,'hello world');
  t.resetForReplay();t.add(shell);t.add(delta);t.add({...delta,content:' world'});assert.equal(t.display()[0]!.text,'hello world');
  t.add(shell);t.add(delta);assert.equal(t.display()[0]!.text,'hello');
  assert.throws(()=>new Timeline().add(delta),/shell/);
});
test('failover classification only accepts the pinned harness terminal model-error format',()=>{
  assert.equal(terminalFailure('[Model Error] Request failed (401): credential').kind,'auth');
  assert.equal(terminalFailure('[Model Error] Request failed (503): busy').kind,'transient');
  for(const message of ['401 provider failed','[MCP Error] Request failed (401): denied','assistant says [Model Error] Request failed (401): bad','[Model Error] Request failed (400): invalid schema'])assert.equal(terminalFailure(message).kind,'harness');
});
test('Scout token cannot discover or invoke write tools and cannot authorize the patch endpoint',async()=>{
  const files=[{path:'a.js',text:'function a() { return 1; }'}];const c=new AbortController();const w=new Workbench(files);
  const scout=await startBridge({workbench:w,signal:c.signal,readOnly:true,review:async()=>{throw new Error('read-only review invoked');}});
  const patch=await startBridge({workbench:new Workbench(files),signal:c.signal,review:async()=>({status:'reviewed'})});
  const client=new Client({name:'scout-test',version:'1'});
  try{await client.connect(new StreamableHTTPClientTransport(new URL(scout.url),{requestInit:{headers:{Authorization:`Bearer ${scout.token}`}}}));
    const names=(await client.listTools()).tools.map(t=>t.name);assert(!names.includes('stage_edit'));assert(!names.includes('submit_for_review'));
    assert.equal((await client.callTool({name:'submit_for_review',arguments:{}})).isError,true);
    assert.equal((await fetch(patch.url,{method:'POST',headers:{Authorization:`Bearer ${scout.token}`},body:'{}'})).status,403);
    const hit=w.trace('a')[0]!;w.read(hit.id,'a.js',1,1);assert.equal(validateWorkOrder('[{"path":"a.js","startLine":1,"endLine":1,"reason":"implementation"}]',w).length,1);
    assert.throws(()=>validateWorkOrder('[{"path":"other.js","startLine":1,"endLine":1,"reason":"invented"}]',w),/unread/);
  }finally{await client.close();await scout.close();await patch.close();}
});
test('missing requirement evidence gives one repair nudge then permits explicit review with warnings',async()=>{
  const f={path:'a.js',text:'function a() { return 1; }'};const w=new Workbench([f]);const hit=w.trace('a')[0]!;const read=w.read(hit.id,f.path,1,1);const start=f.text.indexOf('1');w.stage({path:f.path,revision:read.revision,span:{start,end:start+1},expected:'1',replacement:'2'});
  let reviews=0;const bridge=await startBridge({workbench:w,signal:new AbortController().signal,request:'Add tests and document the change',review:async()=>{reviews++;return {status:'reviewed'};}});const client=new Client({name:'checklist-test',version:'1'});
  try{await client.connect(new StreamableHTTPClientTransport(new URL(bridge.url),{requestInit:{headers:{Authorization:`Bearer ${bridge.token}`}}}));const first=await client.callTool({name:'submit_for_review',arguments:{}});assert.match(JSON.stringify(first),/repair_requested/);assert.equal(reviews,0);await client.callTool({name:'submit_for_review',arguments:{}});assert.equal(reviews,1);}finally{await client.close();await bridge.close();}
});
