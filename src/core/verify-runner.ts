import { spawn } from 'node:child_process';
import { mkdtemp,mkdir,writeFile,rm,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,resolve } from 'node:path';
import { digest,type Snapshot,type CommitPlan } from './change-batch.js';
import { validatePath,validateText,LIMITS } from './validation.js';
import { VerificationLedger,type VerificationInput } from './verification.js';

/** Disposable working copy, NOT an OS sandbox. Run only a trusted, host-configured command. */
export async function verifySnapshot(options:{files:readonly Snapshot[];plan:CommitPlan;executable:string;args:readonly string[];signal:AbortSignal;ledger:VerificationLedger;timeoutMs?:number}) {
  const timeout=options.timeoutMs ?? 30000;
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>120000||!options.executable||options.args.length>128)throw new Error('Invalid verification command or timeout');
  for(const s of [options.executable,...options.args])validateText(s);
  if([options.executable,...options.args].reduce((n,s)=>n+s.length,0)>64000)throw new Error('Verification command size limit');
  const files=new Map<string,string>();const aliases=new Set<string>();let chars=0;
  for(const f of options.files){validatePath(f.path);validateText(f.text);chars+=f.text.length;if(aliases.has(f.path.toLowerCase())||f.text.length>LIMITS.file||chars>LIMITS.batch||files.size>=512)throw new Error('Verification snapshot limit or duplicate path');aliases.add(f.path.toLowerCase());files.set(f.path,f.text);}
  for(const f of options.plan.changes)if(files.get(f.path)!==f.after)throw new Error('Verification snapshot does not match accepted patch');
  options.signal.throwIfAborted();
  const tempBase=await realpath(tmpdir());const directory=await mkdtemp(join(tempBase,'milo-verify-'));
  const env:Record<string,string>={};
  // Do not copy API keys or project env files into the child environment.
  for(const name of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT'])if(process.env[name])env[name]=process.env[name]!;
  env.TEMP=directory;env.TMP=directory;env.TMPDIR=directory;env.HOME=directory;env.USERPROFILE=directory;env.PYTHONDONTWRITEBYTECODE='1';
  const input:VerificationInput={plan:options.plan,inputs:[...files].map(([path,text])=>({path,digest:digest(text)})),command:{executable:options.executable,args:[...options.args],cwd:'.'},environmentDigest:digest(JSON.stringify({env:{...env,TEMP:'<scratch>',TMP:'<scratch>',TMPDIR:'<scratch>',HOME:'<scratch>',USERPROFILE:'<scratch>'},platform:process.platform,arch:process.arch,node:process.version}))};
  try{
    for(const [path,text] of files){options.signal.throwIfAborted();const target=join(directory,...path.split('/'));await mkdir(dirname(target),{recursive:true});await writeFile(target,text,{flag:'wx'});}
    options.signal.throwIfAborted();
    const result=await new Promise<{exitCode:number;timedOut:boolean;output:string;cancelled:boolean}>(resolveResult=>{
      const child=spawn(options.executable,[...options.args],{cwd:directory,env,stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true});
      let output='';let timedOut=false;let cancelled=false;let ended=false;
      const finish=(exitCode:number)=>{if(ended)return;ended=true;clearTimeout(timer);options.signal.removeEventListener('abort',abort);resolveResult({exitCode,timedOut,output,cancelled});};
      const abort=()=>{cancelled=true;child.kill();};
      const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
      options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();
      const append=(data:Buffer)=>{if(Buffer.byteLength(output)+data.length>256000){timedOut=true;child.kill();return;}output+=data.toString();};
      child.stdout.on('data',append);child.stderr.on('data',append);
      child.on('error',error=>{output+=error.message.slice(0,500);finish(-1);});
      // 'exit' settles even if a descendant inherited stdout; descendants are outside this MVP's isolation contract.
      child.on('exit',code=>{child.stdout.destroy();child.stderr.destroy();finish(code ?? -1);});
    });
    const receipt=options.ledger.record(input,{exitCode:result.cancelled?-1:result.exitCode,timedOut:result.timedOut});
    return {...result,receipt,input};
  }finally{
    // Only this newly-created direct child of the known temp root is eligible for recursive removal.
    if(dirname(resolve(directory))!==tempBase||!directory.startsWith(join(tempBase,'milo-verify-')))throw new Error('Unsafe cleanup path');
    await rm(directory,{recursive:true,force:true,maxRetries:2});
  }
}
