import test from 'node:test';import assert from 'node:assert/strict';
import {Workbench} from '../src/core/workbench.js';
test('exact anchors preserve read, revision, uniqueness and selection fences with Unicode and CRLF',()=>{
 const text='# 😀\r\ndef a():\r\n    return 1\r\n\r\ndef b():\r\n    return 2\r\n';
 const w=new Workbench([{path:'a.py',text}],{path:'a.py',span:{start:text.indexOf('def a'),end:text.indexOf('def b')}});
 const hit=w.trace('a')[0]!;const read=w.read(hit.id,'a.py',2,3);
 const input={path:'a.py',revision:read.revision,expected:'return 1',replacement:'return 3'};
 assert.throws(()=>w.stageExact({...input,expected:'return 2'}),/evidence/);
 assert.throws(()=>w.stageExact({...input,expected:'return '}),/exactly once/);
 assert.throws(()=>w.stageExact({...input,expected:''}),/nonempty/);
 const other=w.trace('b')[0]!;w.read(other.id,'a.py',5,6);
 assert.throws(()=>w.stageExact({...input,expected:'return 2'}));
 w.stageExact(input);assert.equal(w.files()[0]!.text,text.replace('return 1','return 3'));
 assert.throws(()=>w.stageExact(input),/Stale/);
});
test('bounded discovery preserves diverse roles and paginates without lost or duplicate hits',()=>{
 const w=new Workbench([{path:'a.py',text:'def action(): pass\n'+ 'action()\n'.repeat(30)},{path:'tests/test_a.py',text:'action()\n'.repeat(8)},{path:'docs/a.md',text:'action\n'.repeat(8)}]);
 const first=w.discover('action',2000);assert(first.bytes<=2000);assert(first.hits.some(h=>h.role==='definition'));assert(first.hits.some(h=>h.role==='test'));assert(first.hits.some(h=>h.role==='documentation'));assert(first.next);
 const all=[...first.hits];let next:number|null=first.next;while(next!==null){const page=w.discover('action',2000,next);assert(page.bytes<=2000);all.push(...page.hits);next=page.next;}
 assert.equal(all.length,first.total);assert.equal(new Set(all.map(h=>`${h.path}:${h.line}`)).size,all.length);
 const hit=first.hits[0]!;assert.match(w.read(hit.id,hit.path,hit.line,hit.line).text,/action/);
});
test('clipped reads report actual bounds and cannot authorize omitted source',()=>{
 const w=new Workbench([{path:'a.py',text:'def a():\n    return 1\n# unread\n'}]);const hit=w.trace('a')[0]!;
 const read=w.readBounded(hit.id,'a.py',1,999,2,4000);assert.equal(read.end_line,2);assert.equal(read.next_line,3);assert.equal(read.clipped,true);assert.equal(read.total_lines,3);
 assert.throws(()=>w.stageExact({path:'a.py',revision:read.revision,expected:'# unread',replacement:'# changed'}),/evidence/);
 assert.throws(()=>w.readBounded('invented','a.py',1,999,2,4000),/discovery/);
 const bytes=w.readBounded(hit.id,'a.py',1,3,80,10);assert.equal(bytes.end_line,1);assert(Buffer.byteLength(bytes.text)<=10);
 const eof=w.readBounded(hit.id,'a.py',3,999,80,4000);assert.equal(eof.next_line,null);assert.equal(eof.end_line,3);
});
