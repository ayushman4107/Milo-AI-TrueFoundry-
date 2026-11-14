import { spawn, execFile } from 'node:child_process';
import { join } from 'node:path';

export type ProcessResult = { exitCode:number; output:string; timedOut:boolean; cancelled:boolean; overflow:boolean; terminationConfirmed:boolean };
/** Trusted command runner. Process groups/trees do not contain processes that deliberately escape. */
export function runProcess(options:{executable:string;args:readonly string[];cwd?:string;env?:NodeJS.ProcessEnv;signal?:AbortSignal;timeoutMs?:number;maxBytes?:number;input?:string;onOutput?:(text:string)=>void}):Promise<ProcessResult>{
  const timeout=options.timeoutMs??30000;const maxBytes=options.maxBytes??256000;
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>120000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>16_000_000)throw new Error('Invalid process bounds');
  if(options.signal?.aborted)return Promise.resolve({exitCode:-1,output:'Cancelled before launch',timedOut:false,cancelled:true,overflow:false,terminationConfirmed:true});
  return new Promise(resolve=>{
    const child=spawn(options.executable,[...options.args],{...(options.cwd?{cwd:options.cwd}:{}),...(options.env?{env:options.env}:{}),stdio:'pipe',shell:false,windowsHide:true,detached:process.platform!=='win32'});
    let chunks:Buffer[]=[];let bytes=0;let timedOut=false;let cancelled=false;let overflow=false;let done=false;let exited=false;let stopping=false;let killConfirmed=true;
    let guard:NodeJS.Timeout|undefined;
    const finish=(code:number)=>{if(done)return;done=true;clearTimeout(timer);if(guard)clearTimeout(guard);options.signal?.removeEventListener('abort',abort);child.stdout.destroy();child.stderr.destroy();resolve({exitCode:code,output:Buffer.concat(chunks).toString('utf8'),timedOut,cancelled,overflow,terminationConfirmed:exited&&killConfirmed});};
    const killTree=()=>{
      if(stopping)return;stopping=true;
      if(!child.pid){child.kill();return;}
      if(process.platform==='win32'){
        killConfirmed=false;
        execFile(join(process.env.SystemRoot??'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:3000},error=>{killConfirmed=!error;if(error)child.kill();if(exited)finish(-1);});
      }else{try{process.kill(-child.pid,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')killConfirmed=false;child.kill('SIGKILL');}}
      guard=setTimeout(()=>finish(-1),4000);
    };
    const abort=()=>{cancelled=true;killTree();};const timer=setTimeout(()=>{timedOut=true;killTree();},timeout);
    options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
    const append=(data:Buffer)=>{if(bytes+data.length>maxBytes){overflow=true;killTree();return;}bytes+=data.length;chunks.push(data);options.onOutput?.(data.toString('utf8'));};
    child.stdout.on('data',append);child.stderr.on('data',append);child.stdin.on('error',()=>{});
    child.on('error',error=>{chunks.push(Buffer.from(error.message.slice(0,500)));exited=true;finish(-1);});
    child.on('exit',()=>{exited=true;if(process.platform!=='win32'&&child.pid){try{process.kill(-child.pid,'SIGKILL');}catch{}}});
    child.on('close',code=>{if(stopping&&process.platform==='win32'&&!killConfirmed)return;finish(code??-1);});
    child.stdin.end(options.input??'');
  });
}
