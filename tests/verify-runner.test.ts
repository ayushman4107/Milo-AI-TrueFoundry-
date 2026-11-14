import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySnapshot } from '../src/core/verify-runner.js';
import { VerificationLedger } from '../src/core/verification.js';
const plan={batchId:'verify',changes:[{path:'a.js',before:'export const n=1;',after:'export const n=2;'}]};
const options={files:[{path:'a.js',text:plan.changes[0]!.after}],plan,executable:process.execPath,args:['-e','const fs=require("fs");if(!fs.readFileSync("a.js","utf8").includes("n=2"))process.exit(2);console.log("checked")'],signal:new AbortController().signal,ledger:new VerificationLedger()};
test('real verifier executes against disposable accepted snapshot and issues a matching receipt',async()=>{
  const result=await verifySnapshot(options);assert.equal(result.receipt.status,'passed');assert.match(result.output,/checked/);assert.equal(options.ledger.status(result.receipt.id,result.input),'passed');
});
test('failed, timed out, missing-executable and pre-cancelled processes cannot pass',async()=>{
  assert.equal((await verifySnapshot({...options,args:['-e','process.exit(7)']})).receipt.status,'failed');
  assert.equal((await verifySnapshot({...options,args:['-e','setInterval(()=>{},1000)'],timeoutMs:50})).receipt.status,'failed');
  assert.equal((await verifySnapshot({...options,executable:'milo-nonexistent-executable'})).receipt.status,'failed');
  await assert.rejects(verifySnapshot({...options,signal:AbortSignal.abort()}));
});
test('verifier rejects stale patches and file escapes before running any command',async()=>{
  await assert.rejects(verifySnapshot({...options,files:[{path:'a.js',text:'stale'}]}),/match/);
  await assert.rejects(verifySnapshot({...options,files:[{path:'../escape',text:'x'}]}));
});
