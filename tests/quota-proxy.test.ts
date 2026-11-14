import test from 'node:test';import assert from 'node:assert/strict';
test('quota transport rejects unauthorized destinations and oversized bodies before forwarding credentials',async()=>{
 const source='../scripts/gemini-quota-proxy.mjs';const {createQuotaProxy}=await import(source);let forwarded=0;
 const key='fictional-test-key';const server=createQuotaProxy({key,fetcher:async(url:string,init:RequestInit)=>{forwarded++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse');assert.equal((init.headers as Record<string,string>)['x-goog-api-key'],key);assert.equal(init.redirect,'error');return new Response('data: example\n\n',{headers:{'content-type':'text/event-stream'}});}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;const headers={'x-goog-api-key':key};
 try{
  assert.equal((await fetch(base+'/anything',{method:'POST'})).status,403);
  assert.equal((await fetch(base+'/anything',{method:'POST',headers:{...headers,Origin:'https://evil.example'}})).status,403);
  for(const path of ['/https://evil.example','/v1beta/models/paid-model:generateContent','/v1beta/models/gemini-3.5-flash:generateContent?key=anything'])assert.equal((await fetch(base+path,{method:'POST',headers})).status,404);
  const path='/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse';assert.equal((await fetch(base+path,{method:'POST',headers,body:'x'.repeat(2_000_001)})).status,413);assert.equal(forwarded,0);
  const response=await fetch(base+path,{method:'POST',headers,body:'{}'});assert.equal(await response.text(),'data: example\n\n');assert.equal(forwarded,1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(r));}
});
