import { readFile,lstat,realpath } from 'node:fs/promises';
import { resolve,relative,isAbsolute,sep } from 'node:path';
import { createHash } from 'node:crypto';
import { runProcess } from './process.js';
import { validatePath } from './validation.js';

export type TreeFile={path:string;bytes:Uint8Array;mode:number};
export type RepositorySnapshot={files:TreeFile[];excluded:{path:string;reason:string}[];complete:boolean;fingerprint:string};
export const byteHash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
export async function containedPath(root:string,path:string){
  validatePath(path);const base=await realpath(root);let cursor=base;
  for(const part of path.split('/')){cursor=resolve(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw new Error('Symlink excluded');}
  const physical=await realpath(cursor);const rel=relative(base,physical);if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`))throw new Error('Path escapes root');
  return physical;
}
export async function repositoryPaths(root:string,signal?:AbortSignal):Promise<string[]>{
  const result=await runProcess({executable:'git',args:['-C',root,'ls-files','--cached','--others','--exclude-standard','-z'],maxBytes:8_000_000,...(signal?{signal}:{})});
  if(result.exitCode!==0||result.overflow)throw new Error('Git index unavailable; open the repository root with Git installed');
  const paths=[...new Set(result.output.split('\0').filter(Boolean))].sort();if(paths.length>20000)throw new Error('Repository exceeds 20,000-file limit');
  for(const path of paths)validatePath(path);return paths;
}
export async function captureRepository(root:string,buffers:ReadonlyMap<string,string>=new Map(),signal?:AbortSignal):Promise<RepositorySnapshot>{
  const paths=[...new Set([...await repositoryPaths(root,signal),...buffers.keys()])].sort();const files:TreeFile[]=[];const excluded:RepositorySnapshot['excluded']=[];let total=0;
  for(const path of paths){signal?.throwIfAborted();validatePath(path);
    if(/(?:^|\/)(?:\.env(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|\.git|\.ssh|\.aws)(?:\/|$)/i.test(path)){excluded.push({path,reason:'sensitive path'});continue;}
    try{const physical=await containedPath(root,path);const stat=await lstat(physical);if(!stat.isFile()||stat.size>4_000_000)throw new Error('Not a regular file or over 4 MB');
      let bytes:Uint8Array=await readFile(physical);const buffer=buffers.get(path);
      if(buffer!==undefined){const bom=bytes[0]===239&&bytes[1]===187&&bytes[2]===191;bytes=Buffer.from((bom&&!buffer.startsWith('\ufeff')?'\ufeff':'')+buffer,'utf8');}
      if(bytes.length>4_000_000||total+bytes.length>64_000_000)throw new Error('Repository snapshot exceeds file or aggregate byte limit');total+=bytes.length;files.push({path,bytes,mode:stat.mode&0o777});
    }catch(e){excluded.push({path,reason:e instanceof Error?e.message:'Read failed'});}
  }
  return {files,excluded,complete:excluded.length===0,fingerprint:byteHash(Buffer.from(JSON.stringify(files.map(f=>[f.path,byteHash(f.bytes),f.mode]))))};
}

/** Watcher-driven invalidation belongs to the host. The index never chooses a model's reads. */
export class SymbolIndex {
  #entries=new Map<string,{hash:string;symbols:string[]}>();
  update(path:string,text:string){validatePath(path);const hash=byteHash(Buffer.from(text));if(this.#entries.get(path)?.hash===hash)return;
    const symbols=[...text.matchAll(/\b(?:def|class|function|const|let|var)\s+([A-Za-z_]\w{0,127})/g)].slice(0,5000).map(m=>m[1]!);this.#entries.set(path,{hash,symbols});}
  invalidate(path?:string){if(path)this.#entries.delete(path);else this.#entries.clear();}
  find(symbol:string){return [...this.#entries].filter(([,e])=>e.symbols.includes(symbol)).map(([path])=>path);}
  names(){return [...new Set([...this.#entries.values()].flatMap(e=>e.symbols))].slice(0,20000);}
}
