import test from 'node:test';
import assert from 'node:assert/strict';
import { traceExemplar, ProvenanceLedger, packContext } from '../src/core/context.js';
import { Overlay, compareInventory } from '../src/core/overlay.js';
import { ModelFailover, HarnessFailure } from '../src/core/failover.js';
import { Workbench } from '../src/core/workbench.js';
import { checkPython } from '../src/core/python-syntax.js';
import { inversePlan } from '../src/core/change-batch.js';
const files = [
  { path:'src/cli.py',text:'@app.command("inspect")\ndef inspect_command():\n    return 1\n\napp.add_command(inspect_command)\n' },
  { path:'tests/test_cli.py',text:'def test_inspect():\n    invoke("inspect")\n' },
  { path:'docs/cli.md',text:'Run inspect to see the output.\n' },
  { path:'CHANGES.rst',text:'Added inspect command.\n' },
];
test('exemplar follows decorator aliases across five roles without prescribed filenames',() => {
  const hits = traceExemplar(files,'inspect_command');
  for (const role of ['definition','registration','test','documentation','changelog']) assert(hits.some(h => h.role === role),role);
  assert.throws(() => traceExemplar(files,'inspect.*'));
  assert.equal(traceExemplar([{path:'x.py',text:'inspect_commands'}],'inspect_command').length,0);
});
test('multiline decorator stacks and noisy references do not hide command docs',()=>{
  const src='@click.command("renamed")\n@click.option(\n    "--sort",\n    help=(\n        "long description"\n    ),\n)\n@with_context\ndef renamed_command():\n    pass\n';
  const hits=traceExemplar([{path:'noisy.py',text:'renamed_command()\n'.repeat(300)},{path:'commands.py',text:src},{path:'docs/usage.md',text:'Use renamed here.'},{path:'tests/test_cli.py',text:'invoke("renamed")'}],'renamed_command');
  assert(hits.some(h=>h.role==='documentation'));assert(hits.some(h=>h.role==='test'));assert(hits.some(h=>h.role==='definition'));
});
test('discovery IDs cannot be invented or reused against another revision/path',() => {
  const p = new ProvenanceLedger(); const hit = p.register(traceExemplar(files,'inspect_command')[0]!);
  assert.throws(() => p.read('fake',files[0]!,1,2));
  assert.throws(() => p.read(hit.id,{...files[0]!,text:'changed'},1,2));
  assert.throws(() => p.read(hit.id,files[1]!,1,2));
  p.read(hit.id,files[0]!,1,2); const copy = p.reads(); copy.length=0; assert.equal(p.reads().length,1);
});
test('context JSON byte budget includes Unicode escaping and metadata at every fidelity',() => {
  const candidate = {id:'a',path:'a.py',reason:'definition',priority:1,levels:['a.py','def a','def a(): "文"','💡'.repeat(200)] as const};
  const seen = new Set<number>();
  for (let budget=2;budget<1200;budget++) {
    const p = packContext([candidate],budget); assert(Buffer.byteLength(p.text)<=budget); if(p.included[0]) seen.add(p.included[0].fidelity);
  }
  assert.equal(seen.size,4);
  assert.throws(() => packContext([candidate,candidate],1000));
  assert.throws(() => packContext([{...candidate,priority:NaN}],1000));
});
test('overlay enforces aggregate load quota, revisions, freeze and case aliases',() => {
  const o = new Overlay(); o.load(files[0]!); const original=o.read(files[0]!.path);
  o.replace(files[0]!.path,original.revision,'new'); assert.equal(o.read(files[0]!.path).text,'new');
  assert.throws(() => o.replace(files[0]!.path,original.revision,'old'));
  assert.throws(() => o.load({path:'SRC/cli.py',text:'a'}));
  o.freeze(); assert.throws(() => o.replace(files[0]!.path,o.read(files[0]!.path).revision,'x'));
  const big = new Overlay(); for(let i=0;i<4;i++)big.load({path:`${i}.txt`,text:'x'.repeat(1_000_000)});
  assert.throws(() => big.load({path:'next.txt',text:'x'}));
});
test('integrity reports relative baseline, removed files and incomplete coverage honestly',() => {
  const baseline={complete:true,disk:new Map([['a','dirty-at-start']]),buffers:new Map([['a','unsaved']])};
  assert.equal(compareInventory(baseline,baseline).status,'unchanged');
  assert.equal(compareInventory({...baseline,complete:false},baseline).status,'unknown');
  assert.deepEqual(compareInventory(baseline,{...baseline,disk:new Map()}).paths,['a']);
});
test('workbench stages two successive revisions, reviews separate hunks, and undoes exact selection',() => {
  const w = new Workbench(files); const p=files[0]!.path;
  let hit=w.trace('inspect_command').find(h=>h.path===p)!; let r=w.read(hit.id,p,1,5);
  const first=r.text.indexOf('return 1');
  w.stage({path:p,revision:r.revision,span:{start:first,end:first+8},expected:'return 1',replacement:'return 2'});
  assert.throws(() => w.stage({path:p,revision:r.revision,span:{start:first,end:first+8},expected:'return 1',replacement:'return 3'}));
  hit=w.trace('inspect_command').find(h=>h.path===p)!; r=w.read(hit.id,p,1,5);
  const second=r.text.indexOf('app.add_command');
  w.stage({path:p,revision:r.revision,span:{start:second,end:second+15},expected:'app.add_command',replacement:'cli.add_command'});
  const review=w.review(); assert.equal(review.proposals.length,2);
  const plan=w.accept([review.proposals[0]!.id],new Map(files.map(f=>[f.path,f.text])));
  assert(plan.changes[0]!.after.includes('return 2')); assert(plan.changes[0]!.after.includes('app.add_command'));
  assert.equal(inversePlan(plan,new Map(plan.changes.map(c=>[c.path,c.after]))).changes[0]!.after,files[0]!.text);
  assert.throws(() => w.accept([review.proposals[0]!.id],new Map()));
});
test('workbench refuses unobserved range and selection escape even after a read',() => {
  const w = new Workbench(files,{path:files[0]!.path,span:{start:0,end:10}});
  const hit=w.trace('inspect_command')[0]!; const r=w.read(hit.id,hit.path,1,5);
  assert.throws(() => w.stage({path:hit.path,revision:r.revision,span:{start:10,end:11},expected:r.text[10]!,replacement:'X'}),/selection/);
  const w2=new Workbench(files); const h=w2.trace('inspect_command')[0]!;const a=w2.read(h.id,h.path,1,1);
  assert.throws(() => w2.stage({path:h.path,revision:a.revision,span:{start:60,end:61},expected:' ',replacement:'X'}),/evidence/);
});
test('workbench preserves CRLF and BOM through shadow edits and conflict revokes approval',() => {
  const f={path:'a.py',text:'\ufeffdef a():\r\n    return 1\r\n'}; const w=new Workbench([f]); const h=w.trace('a')[0]!;const r=w.read(h.id,f.path,1,2);
  const offset=f.text.indexOf('1');w.stage({path:f.path,revision:r.revision,span:{start:offset,end:offset+1},expected:'1',replacement:'2'});
  assert.equal(w.files()[0]!.text,'\ufeffdef a():\r\n    return 2\r\n');
  const review=w.review();assert.throws(()=>w.accept(review.proposals.map(p=>p.id),new Map([[f.path,'externally modified']])));
  assert.throws(()=>w.accept(review.proposals.map(p=>p.id),new Map([[f.path,f.text]])));
});
test('failover abandons failed session before next model and cools down the circuit',async()=>{
  let now=1;const f=new ModelFailover(()=>now);const events:string[]=[];
  const driver={attempt:async(model:string)=>{events.push(model);if(model==='bad')throw new HarnessFailure('auth','401');return 'ok';},abandon:async()=>{events.push('abandon');}};
  const options={models:['bad','good'],request:'x',signal:new AbortController().signal,driver,hasSideEffects:()=>false,onSwitch:()=>{}};
  assert.equal(await f.run(options),'ok');assert.deepEqual(events,['bad','abandon','good']);events.length=0;
  await f.run(options);assert.deepEqual(events,['good']);now+=120001;events.length=0;await f.run(options);assert.equal(events[0],'bad');
});
test('failover does not replay a disconnect, side effect, unknown failure or failed cleanup',async()=>{
  for(const [kind,sideEffect] of [['disconnect',false],['transient',true],['harness',false]] as const){let calls=0;
    await assert.rejects(new ModelFailover().run({models:['a','b'],request:'x',signal:new AbortController().signal,hasSideEffects:()=>sideEffect,onSwitch:()=>{},driver:{attempt:async()=>{calls++;throw new HarnessFailure(kind,'failure');},abandon:async()=>{}}}));assert.equal(calls,1);
  }
  let calls=0;await assert.rejects(new ModelFailover().run({models:['a','b'],request:'x',signal:new AbortController().signal,hasSideEffects:()=>false,onSwitch:()=>{},driver:{attempt:async()=>{calls++;throw new HarnessFailure('auth','401');},abandon:async()=>{throw new Error('uncertain cancellation');}}}));assert.equal(calls,1);
});
test('cancellation during failover cleanup cannot start another model',async()=>{
  const c=new AbortController();let attempts=0;
  await assert.rejects(new ModelFailover().run({models:['a','b'],request:'x',signal:c.signal,hasSideEffects:()=>false,onSwitch:()=>{},driver:{attempt:async()=>{attempts++;throw new HarnessFailure('transient','503');},abandon:async()=>{c.abort();}}}));assert.equal(attempts,1);
});
test('Python validator parses BOM/CRLF, rejects invalid scope without dedenting, and never executes source',async()=>{
  assert.equal((await checkPython('\ufeffdef a():\r\n    return "文"\r\n')).status,'valid');
  assert.equal((await checkPython('    return 1\n')).status,'invalid');
  assert.equal((await checkPython('raise RuntimeError("must not execute")\n')).status,'valid');
  assert.equal((await checkPython('def broken(:\n')).status,'invalid');
});
test('missing Python and cancelled validation are unavailable, never passed',async()=>{
  assert.equal((await checkPython('x=1',{executable:'milo-nonexistent-python'})).status,'unavailable');
  assert.equal((await checkPython('x=1',{signal:AbortSignal.abort()})).status,'unavailable');
});
