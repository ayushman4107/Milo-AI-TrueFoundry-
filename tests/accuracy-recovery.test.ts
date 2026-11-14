import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runProcess} from '../src/core/process.js';
import {captureRepository,SymbolIndex} from '../src/core/repository.js';
import {SaveJournal} from '../src/core/journal.js';
import {analyzePython,enclosingNode} from '../src/core/python-analysis.js';
import {requirements,reviewQuality,rebaseChange} from '../src/core/review-quality.js';
import {TokenEstimate,modelProfile} from '../src/core/model-profile.js';
import {verifyDifferential,verifySnapshot} from '../src/core/verify-runner.js';
import {VerificationLedger} from '../src/core/verification.js';

test('process cancellation terminates a live child tree and never reports success',async()=>{
  const c=new AbortController();let pid=0;
  const script='const {spawn}=require("child_process"); const c=spawn(process.execPath,["-e","console.log(process.pid);setInterval(()=>{},1000)"],{stdio:["ignore","pipe","inherit"]});c.stdout.on("data",x=>process.stdout.write("CHILD:"+x));setInterval(()=>{},1000)';
  const result=await runProcess({executable:process.execPath,args:['-e',script],signal:c.signal,timeoutMs:10000,onOutput:t=>{const m=/CHILD:(\d+)/.exec(t);if(m){pid=Number(m[1]);c.abort();}}});
  assert(pid>0);assert(result.cancelled);assert.notEqual(result.exitCode,0);assert(result.terminationConfirmed);
  await new Promise(r=>setTimeout(r,100));
  let alive=true;try{process.kill(pid,0);if(process.platform==='linux'){const stat=await readFile(`/proc/${pid}/stat`,'utf8');alive=!stat.includes(') Z ');}}catch{alive=false;}
  assert.equal(alive,false,'descendant still running');
});
test('process output overflow and timeout terminate rather than hang',async()=>{
  const overflow=await runProcess({executable:process.execPath,args:['-e','setInterval(()=>console.log("x".repeat(10000)),10)'],maxBytes:1000,timeoutMs:5000});assert(overflow.overflow);
  const timeout=await runProcess({executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:100});assert(timeout.timedOut);
});
test('repository capture covers tracked binary, untracked files and dirty buffers, excludes ignored secrets',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'milo-index-test-'));
  try{assert.equal((await runProcess({executable:'git',args:['init',dir]})).exitCode,0);
    await writeFile(join(dir,'.gitignore'),'.env\nignored.txt\n');await writeFile(join(dir,'.env'),'secret');await writeFile(join(dir,'ignored.txt'),'ignored');await writeFile(join(dir,'data.bin'),Buffer.from([0,255,1]));await writeFile(join(dir,'a.py'),'old');
    assert.equal((await runProcess({executable:'git',args:['-C',dir,'add','data.bin','a.py','.gitignore']})).exitCode,0);await writeFile(join(dir,'new.txt'),'new');
    const tree=await captureRepository(dir,new Map([['a.py','unsaved']]));assert(tree.complete);assert.deepEqual(tree.files.map(f=>f.path).sort(),['.gitignore','a.py','data.bin','new.txt']);assert.equal(Buffer.from(tree.files.find(f=>f.path==='a.py')!.bytes).toString(),'unsaved');
    const again=await captureRepository(dir);assert.notEqual(tree.fingerprint,again.fingerprint);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('verification fixture exceptions require exact paths and never change default model capture',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'milo-fixture-test-'));
 try{await runProcess({executable:'git',args:['init',dir]});await mkdir(join(dir,'tests'));await writeFile(join(dir,'tests','.env'),'PUBLIC_FIXTURE=yes');await writeFile(join(dir,'tests','.env.private'),'secret');
  const normal=await captureRepository(dir);assert.equal(normal.files.length,0);
  const allowed=await captureRepository(dir,new Map(),undefined,new Set(['tests/.env']));assert.deepEqual(allowed.files.map(f=>f.path),['tests/.env']);assert.equal(allowed.complete,false);
  assert.equal((await captureRepository(dir)).files.length,0);
  assert.equal((await captureRepository(dir,new Map(),undefined,new Set(['tests/']))).files.length,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('symbol index invalidates without choosing edits',()=>{const index=new SymbolIndex();index.update('a.py','def foo(): pass');assert.deepEqual(index.find('foo'),['a.py']);index.update('a.py','def bar(): pass');assert.deepEqual(index.find('foo'),[]);index.invalidate('a.py');assert.deepEqual(index.names(),[]);});
test('Python analysis resolves real scopes, flags invented globals and maps Unicode offsets',async()=>{
  const text='\ufeff# 文\r\nimport os\r\ndef existing(x):\r\n    """A nearby convention."""\r\n    return os.path.join(x, missing_helper())\r\n';
  const a=await analyzePython(text,{repoNames:['existing_helper']});assert.equal(a.status,'valid',a.message);assert(a.symbols?.some(s=>s.name==='missing_helper'));assert(!a.symbols?.some(s=>s.name==='x'||s.name==='os'));
  const node=enclosingNode(a,text.indexOf('return'),text.indexOf('return')+6);assert.equal(node?.name,'existing');assert.equal(text.slice(node!.start,node!.start+3),'def');assert.equal(node?.docstring,'A nearby convention.');
});
test('quality labels only syntax-equivalent formatting, preserves semantic/string changes',async()=>{
  const q=await reviewQuality([{path:'a.py',before:'x = 1\n',after:'x=1\n'},{path:'b.py',before:'x="a b"\n',after:'x="ab"\n'}]);assert.equal(q[0]!.formattingOnly,true);assert.equal(q[1]!.formattingOnly,false);
  const req=requirements('Add a test, document it and show it in --help',[{path:'tests/test_a.py',before:'',after:'def test_a(): pass'}]);assert.equal(req.find(r=>r.id==='tests')!.status,'evidence');assert.equal(req.find(r=>r.id==='docs')!.status,'missing');assert.match(req[0]!.explanation,/not a passing/);
});
test('rebase preserves disjoint edits and rejects ambiguous/overlapping changes',()=>{
  const before='header\n'+'.'.repeat(100)+'\nreturn 1\n'+'.'.repeat(100)+'\nfooter';const file={path:'a.py',before,after:before.replace('return 1','return 2')};
  const result=rebaseChange(file,before.replace('header','user header'));assert(result.after.startsWith('user header'));assert(result.after.includes('return 2'));
  assert.throws(()=>rebaseChange(file,before.replace('return 1','return 3')));
});
test('journal recovers interrupted save but preserves later user edits and dirty buffers',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'milo-journal-test-'));const root=join(dir,'repo');await mkdir(root);await writeFile(join(root,'a.txt'),'a');await writeFile(join(root,'b.txt'),'b');
  const plan={batchId:'journal-test',changes:[{path:'a.txt',before:'a',after:'A'},{path:'b.txt',before:'b',after:'B'}]};const journal=new SaveJournal(join(dir,'storage'),root);
  try{
    await assert.rejects(journal.save(plan,{afterWrite:()=>{throw new Error('simulated crash');}}));assert.equal(await readFile(join(root,'a.txt'),'utf8'),'A');
    assert.equal((await journal.recover(new Set(['a.txt'])))[0]!.status,'conflict');
    assert.equal((await journal.recover())[0]!.status,'rolled-back');assert.equal(await readFile(join(root,'a.txt'),'utf8'),'a');
    await assert.rejects(journal.save(plan,{afterWrite:()=>{throw new Error('simulated crash');}}));await writeFile(join(root,'a.txt'),'user changed');
    assert.equal((await journal.recover())[0]!.status,'conflict');assert.equal(await readFile(join(root,'a.txt'),'utf8'),'user changed');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('token estimates label heuristics and reject incompatible calibration samples',()=>{const e=new TokenEstimate();assert.equal(e.estimate('m','12345678').approxTokens,2);e.observeOutput('m','x'.repeat(100),20);assert.equal(e.estimate('m','x'.repeat(50)).approxTokens,10);e.observeOutput('m','x',1000);assert.equal(e.estimate('m','x').samples,1);assert(modelProfile(true).contextBytes<modelProfile(false).contextBytes);});
test('differential verifier keeps changed tests on base and distinguishes a real regression',async()=>{
  const plan={batchId:'diff',changes:[{path:'a.js',before:'module.exports=1;',after:'module.exports=2;'},{path:'tests/test_a.js',before:'',after:'if(require("../a.js")!==2)process.exit(1);'}]};
  const result=await verifyDifferential({files:plan.changes.map(f=>({path:f.path,text:f.after})),plan,executable:process.execPath,args:['tests/test_a.js'],signal:new AbortController().signal,ledger:new VerificationLedger()});assert.equal(result.status,'fails-on-base-passes-on-patch');
});
test('verification copies binary fixtures beyond model context and import canary rejects external modules',async()=>{
  const plan={batchId:'binary',changes:[{path:'a.js',before:'1',after:'2'}]};
  const options={files:[{path:'a.js',text:'2'}],tree:[{path:'fixture.bin',bytes:Buffer.from([0,255]),mode:0o600}],plan,executable:process.execPath,args:['-e','if(require("fs").readFileSync("fixture.bin")[1]!==255)process.exit(1)'],signal:new AbortController().signal,ledger:new VerificationLedger()};
  assert.equal((await verifySnapshot(options)).receipt.status,'passed');
  await assert.rejects(verifySnapshot({...options,python:process.env.MILO_PYTHON??(process.platform==='win32'?'python':'python3'),importCanary:'json'}),/canary failed/);
});
