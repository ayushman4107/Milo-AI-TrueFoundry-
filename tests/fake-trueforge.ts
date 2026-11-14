import {createServer,type ServerResponse} from 'node:http';import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
/** Deterministic TrueForge wire fixture. It invokes real Milo MCP tools but is not real-model evidence. */
export async function fakeTrueForge(){
 const bridges=new Map<string,{url:string;headers:Record<string,string>}>();const sessions=new Map<string,string>();const clients=new Set<Client>();const errors:string[]=[];
 const event=(res:ServerResponse,value:Record<string,unknown>)=>res.write(`data: ${JSON.stringify({created_at:new Date().toISOString(),thread_id:null,previous_turn_id:null,state:{status:'running'},...value,turn_id:value.turnId})}\n\n`);
 const server=createServer(async(req,res)=>{try{
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};const url=new URL(req.url??'/','http://127.0.0.1');
  const json=(data:unknown)=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(data));
  if(req.method==='POST'&&url.pathname==='/api/v1/settings/mcp-servers'){bridges.set(body.manifest.name,{url:body.manifest.url,headers:body.manifest.auth.headers});json({data:{}});return;}
  if(req.method==='DELETE'){bridges.delete(decodeURIComponent(url.pathname.split('/').at(-1)!));json({});return;}
  if(req.method==='POST'&&url.pathname==='/api/v1/sessions'){const id=randomUUID();sessions.set(id,body.agent.spec.mcp_servers[0].name);json({data:{id}});return;}
  if(url.pathname.endsWith('/cancel')){json({data:{}});return;}
  if(req.method==='POST'&&url.pathname.endsWith('/turns')){
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.flushHeaders();const id=url.pathname.split('/')[4]!;const turnId=randomUUID();event(res,{type:'turn.created',id:randomUUID(),turnId});
   const bridge=bridges.get(sessions.get(id)!)!;const client=new Client({name:'fake-harness',version:'1'});clients.add(client);
   try{await client.connect(new StreamableHTTPClientTransport(new URL(bridge.url),{requestInit:{headers:bridge.headers}}));
    const call=async(name:string,args:Record<string,unknown>)=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw new Error(JSON.stringify(r));return JSON.parse((r.content as {text:string}[])[0]!.text);};
    const {hits}=await call('trace_exemplar',{symbol:'action'});const hit=hits.find((h:{path:string})=>h.path==='action.js');const read=await call('read_evidence',{discovery_id:hit.id,path:'action.js',start_line:1,end_line:1});
    const start=read.text.indexOf('1');await call('stage_edit',{path:'action.js',revision:read.revision,span:{start,end:start+1},expected:'1',replacement:'2'});
    await call('submit_for_review',{});event(res,{type:'turn.done',id:randomUUID(),turnId,state:{status:'done'}});res.end();
   }catch(e){if(!res.destroyed){errors.push(String(e));event(res,{type:'turn.done',id:randomUUID(),turnId,state:{status:'error',message:'Fake tool flow failed'}});res.end();}}finally{clients.delete(client);await client.close();}return;
  }
  res.writeHead(404).end();
 }catch(e){errors.push(String(e));res.writeHead(500).end();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw new Error('No fake port');
 return {url:`http://127.0.0.1:${address.port}`,errors,close:async()=>{for(const c of clients)await c.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}};
}
