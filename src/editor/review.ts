import * as vscode from 'vscode';
import {randomBytes} from 'node:crypto';
import type {Requirement} from '../core/review-quality.js';
import {reviewHtml,type ReviewRow} from './review-html.js';
export type {ReviewRow} from './review-html.js';
/** Nonce-scoped messages are decisions; the host still validates revisions and owns commit authority. */
export function keyboardReview(rows:readonly ReviewRow[],checklist:readonly Requirement[],signal:AbortSignal,verify?:(signal:AbortSignal)=>Promise<string>):Promise<string[]|undefined>{
  if(signal.aborted)return Promise.resolve(undefined);
  const panel=vscode.window.createWebviewPanel('milo.review','Milo: review changes',vscode.ViewColumn.Beside,{enableScripts:true});
  const nonce=randomBytes(24).toString('hex');const local=new AbortController();
  panel.webview.html=reviewHtml(rows,checklist,nonce,!!verify);
  return new Promise(resolve=>{
    let done=false,verifying=false;const known=new Set(rows.map(r=>r.id));
    const finish=(ids?:string[])=>{if(done)return;done=true;local.abort();signal.removeEventListener('abort',abort);message.dispose();disposed.dispose();panel.dispose();resolve(ids);};
    const abort=()=>finish();
    const message=panel.webview.onDidReceiveMessage((value:unknown)=>{
      if(!value||typeof value!=='object')return;const m=value as Record<string,unknown>;if(m.token!==nonce)return;
      if(m.kind==='cancel')finish();
      else if(m.kind==='verify'&&verify&&!verifying&&!done){verifying=true;void verify(AbortSignal.any([signal,local.signal])).catch(e=>`Verification unavailable: ${e instanceof Error?e.message:String(e)}`).then(text=>{verifying=false;if(!done)void panel.webview.postMessage({token:nonce,kind:'verification',text});});}
      else if(m.kind==='confirm'&&!verifying&&Array.isArray(m.ids)&&m.ids.length<=rows.length&&m.ids.every(id=>typeof id==='string'&&known.has(id))&&new Set(m.ids).size===m.ids.length)finish(m.ids as string[]);
    });
    const disposed=panel.onDidDispose(()=>finish());signal.addEventListener('abort',abort,{once:true});if(signal.aborted)finish();
  });
}
