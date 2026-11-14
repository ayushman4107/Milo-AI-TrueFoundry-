import test from 'node:test';import assert from 'node:assert/strict';import {summarize,safeError} from '../scripts/eval-cases.js';
test('benchmark aggregates failures in denominators without inventing missing timings',()=>{
 const rows=[{task:'A',model:'small',status:'passed',timeToDiffMs:10,usage:[{inputTokens:90,outputTokens:5}]},{task:'A',model:'small',status:'failed',timeToDiffMs:30,guardrails:['scope']},{task:'A',model:'small',status:'quota-blocked',timeToDiffMs:null},{task:'B',model:'small',status:'failed'}];
 const [a,b]=summarize(rows);assert.equal(a!.attempted,3);assert.equal(a!.passed,1);assert.equal(a!.quotaBlocked,1);assert.equal(a!.medianReviewMs,20);assert.equal(a!.inputTokens,90);assert.deepEqual(a!.guardrails,['scope']);assert.equal(b!.medianReviewMs,null);
 assert.equal(safeError('key AQ.example_value Bearer fictionalToken12345'), 'key [redacted-key] Bearer [redacted]');
});
