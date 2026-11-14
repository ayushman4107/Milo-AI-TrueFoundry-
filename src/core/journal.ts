import {mkdir,open,rename,readFile,readdir,lstat,realpath,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {type CommitPlan} from './change-batch.js';
import {copyPlan} from './commit-coordinator.js';
import {byteHash,containedPath} from './repository.js';
import {validatePath} from './validation.js';

type Entry={path:string;before:string;after:string;mode:number};
type Manifest={version:1;root:string;state:'prepared'|'committed'|'rolled-back';files:Entry[]};
async function durable(path:string,bytes:Uint8Array){const handle=await open(path,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
async function directorySync(path:string){if(process.platform==='win32')return;const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function atomic(path:string,bytes:Uint8Array,expected?:string,mode=0o600){const temp=join(dirname(path),`.milo-${randomUUID()}.tmp`);
  try{await durable(temp,bytes);if(expected!==undefined&&byteHash(await readFile(path))!==expected)throw new Error(`Disk changed before rename: ${path}`);const h=await open(temp,'r+');try{await h.chmod(mode);await h.sync();}finally{await h.close();}await rename(temp,path);await directorySync(dirname(path));}
  finally{await unlink(temp).catch(e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;});}
}

/** Explicit disk save with guarded rollback. Never promises cross-file atomicity or hostile-process isolation. */
export class SaveJournal {
  constructor(private readonly storage:string,private readonly root:string){}
  async #folder(){const root=await realpath(this.root);const folder=join(this.storage,byteHash(Buffer.from(root)).slice(0,24));await mkdir(folder,{recursive:true});return {root,folder};}
  async save(input:CommitPlan,options:{signal?:AbortSignal;afterWrite?:(index:number)=>void|Promise<void>}={}){
    const plan=copyPlan(input);const {root,folder}=await this.#folder();const directory=join(folder,randomUUID());const entries:Entry[]=[];const snapshots:Buffer[]=[];
    for(const file of plan.changes){options.signal?.throwIfAborted();const target=await containedPath(root,file.path);const stat=await lstat(target);if(stat.nlink>1)throw new Error('Journal save refuses hardlinked files');const bytes=await readFile(target);const bom=bytes[0]===239&&bytes[1]===187&&bytes[2]===191;const decoded=bytes.toString('utf8');
      if(decoded!==file.before&&!(bom&&decoded.slice(1)===file.before))throw new Error(`Disk baseline differs: ${file.path}; resolve unsaved baseline first`);
      const after=Buffer.from((bom&&!file.after.startsWith('\ufeff')?'\ufeff':'')+file.after);entries.push({path:file.path,before:byteHash(bytes),after:byteHash(after),mode:stat.mode&0o777});snapshots.push(bytes);}
    await mkdir(directory);for(let i=0;i<snapshots.length;i++)await durable(join(directory,`${i}.before`),snapshots[i]!);
    const manifest:Manifest={version:1,root,state:'prepared',files:entries};await durable(join(directory,'manifest.json'),Buffer.from(JSON.stringify(manifest)));await directorySync(directory);
    for(let i=0;i<entries.length;i++){options.signal?.throwIfAborted();const e=entries[i]!;const before=snapshots[i]!;const bom=before[0]===239&&before[1]===187&&before[2]===191;const after=plan.changes[i]!.after;await atomic(await containedPath(root,e.path),Buffer.from((bom&&!after.startsWith('\ufeff')?'\ufeff':'')+after),e.before,e.mode);await options.afterWrite?.(i);}
    manifest.state='committed';await atomic(join(directory,'manifest.json'),Buffer.from(JSON.stringify(manifest)));return {transaction:directory,status:'committed' as const};
  }
  async recover(protectedPaths:ReadonlySet<string>|(()=>ReadonlySet<string>)=new Set()){
    const {root,folder}=await this.#folder();const results:{id:string;status:'rolled-back'|'conflict'|'invalid'|'committed';paths:string[]}[]=[];
    for(const d of (await readdir(folder,{withFileTypes:true})).filter(d=>d.isDirectory()&&!d.isSymbolicLink()).slice(0,1000)){
      if(!/^[a-f0-9-]{36}$/.test(d.name))continue;const directory=join(folder,d.name);
      try{const raw=await readFile(join(directory,'manifest.json'));if(raw.length>128000)throw new Error('Oversized journal');const m=JSON.parse(raw.toString()) as Manifest;
        if(m.version!==1||m.root!==root||!Array.isArray(m.files)||m.files.length<1||m.files.length>128||!['prepared','committed','rolled-back'].includes(m.state))throw new Error('Invalid journal');
        if(m.state!=='prepared'){continue;}const paths:string[]=[];const rollback:{path:string;relative:string;bytes:Buffer;expected:string;mode:number}[]=[];const seen=new Set<string>();
        for(let i=0;i<m.files.length;i++){const e=m.files[i]!;validatePath(e.path);if(seen.has(e.path.toLowerCase())||!Number.isInteger(e.mode)||e.mode<0||e.mode>511||!(/^[a-f0-9]{64}$/).test(e.before)||!(/^[a-f0-9]{64}$/).test(e.after))throw new Error('Invalid entry');seen.add(e.path.toLowerCase());
          const snapshot=await readFile(join(directory,`${i}.before`));if(snapshot.length>4_000_000||byteHash(snapshot)!==e.before)throw new Error('Corrupt journal snapshot');
          const target=await containedPath(root,e.path);if((await lstat(target)).nlink>1)throw new Error('Hardlink conflict');const current=byteHash(await readFile(target));
          if((typeof protectedPaths==='function'?protectedPaths():protectedPaths).has(e.path)||(current!==e.before&&current!==e.after))paths.push(e.path);else if(current===e.after)rollback.push({path:target,relative:e.path,bytes:snapshot,expected:e.after,mode:e.mode});
        }
        if(paths.length){results.push({id:d.name,status:'conflict',paths});continue;}
        for(const f of rollback){if((typeof protectedPaths==='function'?protectedPaths():protectedPaths).has(f.relative))throw new Error('Buffer changed during recovery');await atomic(f.path,f.bytes,f.expected,f.mode);}m.state='rolled-back';await atomic(join(directory,'manifest.json'),Buffer.from(JSON.stringify(m)));results.push({id:d.name,status:'rolled-back',paths:rollback.map(f=>f.path)});
      }catch{results.push({id:d.name,status:'invalid',paths:[]});}
    }
    return results;
  }
}
