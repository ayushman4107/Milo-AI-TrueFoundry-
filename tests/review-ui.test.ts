import test from 'node:test';import assert from 'node:assert/strict';import {runInNewContext} from 'node:vm';
import {reviewHtml,type ReviewRow} from '../src/editor/review-html.js';import {ReviewState} from '../src/core/review-state.js';
const rows:ReviewRow[]=[{id:'source',path:'a.py',role:'source',before:'a',after:'b',formattingOnly:false,warnings:[]},{id:'noise',path:'b.py',role:'source',before:'x = 1',after:'x=1',formattingOnly:true,warnings:[]},{id:'test',path:'tests/test_a.py',role:'tests',before:'',after:'<img src=x onerror="alert(1)">',formattingOnly:false,warnings:['<script>bad()</script>']}];
test('host review decisions preserve rejection, noise defaults and reversible keyboard/checkbox choices',()=>{
 const s=new ReviewState(rows);assert.deepEqual(s.snapshot().selected,['source','test']);s.dispatch('reject');assert.deepEqual(s.snapshot().selected,['test']);s.dispatch('undoDecision');s.dispatch('next');s.dispatch('accept');assert.equal(s.snapshot().selected.length,3);s.dispatch('rejectNoise');assert.deepEqual(s.snapshot().selected,['source','test']);s.choose('test',false);s.dispatch('undoDecision');assert.deepEqual(s.snapshot().selected,['source','test']);assert.throws(()=>s.choose('invented',true));
});
test('webview escapes HTML, emits decisions only with focus outside inputs, and trusts nonce-scoped host state',()=>{
 const html=reviewHtml(rows,[],'testnonce',true);assert(!html.includes('<img'));assert(!html.includes('<script>bad'));assert(html.includes('&lt;img'));assert.match(html,/<details ><summary>/);
 const script=/<script nonce="testnonce">([\s\S]*)<\/script>/.exec(html)![1]!;const events:Record<string,(e:any)=>void>={};const windowEvents:Record<string,(e:any)=>void>={};const sent:any[]=[];let focused=true;
 const articles=rows.map(r=>{const box={checked:!r.formattingOnly,addEventListener:(n:string,f:(e:any)=>void)=>events[`${r.id}:${n}`]=f};return {box,dataset:{id:r.id},classList:{toggle:()=>{}},scrollIntoView:()=>{},querySelector:()=>box};});
 const controls:Record<string,{onclick?:()=>void;disabled:boolean;textContent:string}>=Object.fromEntries(['noise','confirm','cancel','verify','verification'].map(id=>[id,{disabled:false,textContent:''}]));
 runInNewContext(script,{document:{hasFocus:()=>focused,querySelectorAll:(q:string)=>q==='article'?articles:[],getElementById:(id:string)=>controls[id],addEventListener:(n:string,f:(e:any)=>void)=>events[n]=f},window:{addEventListener:(n:string,f:(e:any)=>void)=>windowEvents[n]=f},acquireVsCodeApi:()=>({postMessage:(m:any)=>sent.push(m)})});
 assert.equal(sent.shift().kind,'ready');const key=(key:string,editable=false)=>events.keydown!({key,target:{closest:()=>editable?{}:null},preventDefault:()=>{}});
 focused=false;key('a');focused=true;key('r',true);assert.equal(sent.length,0);for(const k of ['a','r','j','k','u'])key(k);assert.deepEqual(sent.map(m=>m.action),['accept','reject','next','previous','undoDecision']);
 windowEvents.message!({data:{token:'wrong',kind:'state',selected:[]}});assert.equal(articles[0]!.box.checked,true);
 windowEvents.message!({data:{token:'testnonce',kind:'state',selected:['test'],activeId:'test',verifying:true}});assert.equal(articles[0]!.box.checked,false);assert.equal(controls.confirm!.disabled,true);
 windowEvents.message!({data:{token:'testnonce',kind:'verification',text:'<img> passed'}});assert.equal(controls.verification!.textContent,'<img> passed');
 controls.confirm!.onclick!();assert.equal(sent.at(-1).action,'confirm');assert.equal(sent.at(-1).ids,undefined,'webview cannot supply authoritative accepted IDs');
});
