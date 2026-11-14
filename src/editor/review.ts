import * as vscode from 'vscode';
import {randomBytes} from 'node:crypto';
import type {Requirement} from '../core/review-quality.js';
import {reviewHtml,type ReviewRow} from './review-html.js';
import {ReviewState,type ReviewAction} from '../core/review-state.js';
export type {ReviewRow} from './review-html.js';
const actions=new Set<string>(['next','previous','accept','reject','undoDecision','rejectNoise','confirm','cancel','verify']);
let active:{dispatch:(action:string)=>void;state:ReviewState}|undefined;
export function reviewSnapshot(){return active?.state.snapshot();}
export function reviewCommand(action:string){if(!active)throw new Error('No review is open');if(!actions.has(action))throw new Error('Unknown review command');active.dispatch(action);return active?.state.snapshot();}
/** Nonce-scoped messages are decisions; the host still validates revisions and owns commit authority. */
export function keyboardReview(rows:readonly ReviewRow[],checklist:readonly Requirement[],signal:AbortSignal,verify?:(signal:AbortSignal)=>Promise<string>):Promise<string[]|undefined>{
  if(signal.aborted)return Promise.resolve(undefined);
  if(active)throw new Error('A review is already open');
  const panel=vscode.window.createWebviewPanel('milo.review','Milo: review changes',vscode.ViewColumn.Beside,{enableScripts:true});
  const nonce=randomBytes(24).toString('hex');const local=new AbortController();
  const sorted=[...rows].sort((a,b)=>['source','tests','docs'].indexOf(a.role)-['source','tests','docs'].indexOf(b.role)||a.path.localeCompare(b.path));
  const state=new ReviewState(sorted);
  panel.webview.html=reviewHtml(sorted,checklist,nonce,!!verify);
  void vscode.commands.executeCommand('setContext','milo.reviewActive',true);
  return new Promise(resolve=>{
    let done=false,verifying=false;
    const sync=()=>{if(!done)void panel.webview.postMessage({token:nonce,kind:'state',...state.snapshot(),verifying});};
    const finish=(ids?:string[])=>{if(done)return;done=true;active=undefined;void vscode.commands.executeCommand('setContext','milo.reviewActive',false);local.abort();signal.removeEventListener('abort',abort);message.dispose();disposed.dispose();panel.dispose();resolve(ids);};
    const abort=()=>finish();
    const dispatch=(action:string)=>{
      if(done)return;
      if(action==='cancel'){finish();return;}
      if(action==='verify'&&verify&&!verifying){verifying=true;sync();void verify(AbortSignal.any([signal,local.signal])).catch(e=>`Verification unavailable: ${e instanceof Error?e.message:String(e)}`).then(text=>{verifying=false;if(!done){void panel.webview.postMessage({token:nonce,kind:'verification',text});sync();}});return;}
      if(action==='confirm'){if(!verifying)finish(state.snapshot().selected);return;}
      if(actions.has(action)&&!verifying){state.dispatch(action as ReviewAction);sync();}
    };
    active={dispatch,state};
    const message=panel.webview.onDidReceiveMessage((value:unknown)=>{
      if(!value||typeof value!=='object')return;const m=value as Record<string,unknown>;if(m.token!==nonce)return;
      if(m.kind==='ready'){sync();return;}
      if(m.kind==='action'&&typeof m.action==='string'&&actions.has(m.action))dispatch(m.action);
      else if(m.kind==='choose'&&!verifying&&typeof m.id==='string'&&typeof m.checked==='boolean'&&rows.some(r=>r.id===m.id)){state.choose(m.id,m.checked);sync();}
    });
    const disposed=panel.onDidDispose(()=>finish());signal.addEventListener('abort',abort,{once:true});if(signal.aborted)finish();
  });
}
