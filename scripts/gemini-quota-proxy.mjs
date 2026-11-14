// Optional benchmark transport: serial spacing, no model loop, retries, or credential logging.
// Run in the same OS as TrueForge. Stop it and restore Google's base URL after the rehearsal.
import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {timingSafeEqual} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';import {pathToFileURL} from 'node:url';
export function createQuotaProxy({key,interval=13000,fetcher=fetch}){
if(!key||!Number.isFinite(interval)||interval<13000)throw new Error('A key and at least 13 seconds for Flash are required');
const next=new Map();let active=0;
const server=createServer(async(req,res)=>{
 const token=Buffer.from(String(req.headers['x-goog-api-key']??'')),expected=Buffer.from(key);
 if(req.headers.origin||!/^127\.0\.0\.1:\d+$/.test(req.headers.host??'')||token.length!==expected.length||!timingSafeEqual(token,expected)){res.writeHead(403).end();return;}
 if(req.method!=='POST'||!/^\/v1beta\/models\/gemini-3\.5-flash(?:-lite)?:(?:generateContent|streamGenerateContent)(?:\?alt=sse)?$/.test(req.url??'')){res.writeHead(404).end();return;}
 if(active>=4){res.writeHead(429,{'retry-after':'60'}).end('Local pacing queue full');return;}active++;
 const abort=new AbortController();res.on('close',()=>abort.abort());
 try{
  let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>2_000_000){res.writeHead(413).end();return;}chunks.push(chunk);}
  const model=req.url.includes('flash-lite')?'lite':'flash';const gap=model==='lite'?4500:interval;const slot=Math.max(Date.now(),next.get(model)??0);next.set(model,slot+gap);await delay(Math.max(0,slot-Date.now()),undefined,{signal:abort.signal});abort.signal.throwIfAborted();
  const upstream=await fetcher(`https://generativelanguage.googleapis.com${req.url}`,{method:'POST',headers:{'x-goog-api-key':key,'content-type':'application/json'},body:Buffer.concat(chunks),redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(120000)])});
  console.log(JSON.stringify({at:new Date().toISOString(),model:req.url.includes('flash-lite')?'flash-lite':'flash',status:upstream.status}));
  res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json',...(upstream.headers.has('retry-after')?{'retry-after':upstream.headers.get('retry-after')}:{})});
  if(upstream.body)await pipeline(Readable.fromWeb(upstream.body),res);else res.end();
 }catch{if(!res.headersSent)res.writeHead(502).end('Quota transport unavailable');else res.destroy();}finally{active--;}
});
server.requestTimeout=15000;server.headersTimeout=10000;
return server;
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
const key=(await readFile(process.env.MILO_GEMINI_KEY_FILE,'utf8')).trim();const server=createQuotaProxy({key,interval:Number(process.env.MILO_GOOGLE_INTERVAL_MS??13000)});
server.listen(Number(process.env.MILO_GOOGLE_PROXY_PORT??18791),'127.0.0.1',()=>console.log('Gemini pacing proxy listening on loopback; no automatic retries'));
}
