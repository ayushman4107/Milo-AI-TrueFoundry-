import { mkdtemp,mkdir,writeFile,rm,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,resolve } from 'node:path';
import { digest,type Snapshot,type CommitPlan } from './change-batch.js';
import { validatePath,validateText,LIMITS } from './validation.js';
import { VerificationLedger,type VerificationInput } from './verification.js';
import { runProcess } from './process.js';
import { byteHash,type TreeFile } from './repository.js';

export type VerifyOptions={files:readonly Snapshot[];tree?:readonly TreeFile[];plan:CommitPlan;executable:string;args:readonly string[];signal:AbortSignal;ledger:VerificationLedger;timeoutMs?:number;python?:string;importCanary?:string};
/** Hardened trusted command in a disposable tree, not an OS sandbox. */
export async function verifySnapshot(options:VerifyOptions) {
  const timeout=options.timeoutMs??30000;
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>120000||!options.executable||options.args.length>128)throw new Error('Invalid verification command or timeout');
  for(const s of [options.executable,...options.args])validateText(s);
  if([options.executable,...options.args].reduce((n,s)=>n+s.length,0)>64000)throw new Error('Verification command size limit');
  const files=new Map<string,string>();const aliases=new Set<string>();let chars=0;
  for(const f of options.files){validatePath(f.path);validateText(f.text);chars+=f.text.length;if(aliases.has(f.path.toLowerCase())||f.text.length>LIMITS.file||chars>LIMITS.batch||files.size>=512)throw new Error('Verification snapshot limit or duplicate path');aliases.add(f.path.toLowerCase());files.set(f.path,f.text);}
  for(const f of options.plan.changes)if(files.get(f.path)!==f.after)throw new Error('Verification snapshot does not match accepted patch');
  const tree=new Map<string,TreeFile>();const treeAliases=new Set<string>();let size=0;
  for(const f of options.tree??[]){validatePath(f.path);size+=f.bytes.length;if(size>64_000_000||tree.size>=20000||treeAliases.has(f.path.toLowerCase()))throw new Error('Verification tree size or alias limit');treeAliases.add(f.path.toLowerCase());tree.set(f.path,{...f,bytes:Buffer.from(f.bytes)});}
  for(const [path,text] of files){const old=tree.get(path);if(!old&&treeAliases.has(path.toLowerCase()))throw new Error('Overlay tree alias');const bom=old?.bytes[0]===239&&old.bytes[1]===187&&old.bytes[2]===191;tree.set(path,{path,bytes:Buffer.from((bom&&!text.startsWith('\ufeff')?'\ufeff':'')+text),mode:old?.mode??0o600});}
  if(tree.size>20000||[...tree.values()].reduce((n,f)=>n+f.bytes.length,0)>64_000_000)throw new Error('Final verification tree exceeds limits');
  options.signal.throwIfAborted();
  const tempBase=await realpath(tmpdir());const directory=await mkdtemp(join(tempBase,'milo-verify-'));
  const env:Record<string,string>={};
  for(const name of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT'])if(process.env[name])env[name]=process.env[name]!;
  env.TEMP=directory;env.TMP=directory;env.TMPDIR=directory;env.HOME=directory;env.USERPROFILE=directory;env.PYTHONDONTWRITEBYTECODE='1';
  env.PYTHONPATH=[join(directory,'src'),directory].join(process.platform==='win32'?';':':');
  let dependency={version:'not requested',pipHash:'not requested',complete:!options.python};let canary='not requested';
  try{
    for(const [path,file] of tree){options.signal.throwIfAborted();const target=join(directory,...path.split('/'));await mkdir(dirname(target),{recursive:true});await writeFile(target,file.bytes,{flag:'wx',mode:file.mode});}
    if(options.python){
      const version=await runProcess({executable:options.python,args:['--version'],env,signal:options.signal,timeoutMs:5000});
      const pip=await runProcess({executable:options.python,args:['-m','pip','freeze','--all'],env,signal:options.signal,timeoutMs:15000,maxBytes:1_000_000});
      dependency={version:version.output.trim(),pipHash:digest(pip.output.split(/\r?\n/).sort().join('\n')),complete:version.exitCode===0&&pip.exitCode===0&&!pip.overflow};
    }
    if(options.importCanary){
      if(!options.python||!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(options.importCanary))throw new Error('Import canary requires Python and a module name');
      const probe=await runProcess({executable:options.python,args:['-c','import importlib,os,sys; m=importlib.import_module(sys.argv[1]); p=os.path.realpath(m.__file__); r=os.path.realpath(sys.argv[2]); print(p); sys.exit(0 if os.path.commonpath([p,r])==r else 3)',options.importCanary,directory],cwd:directory,env,signal:options.signal,timeoutMs:5000});
      canary=probe.output.trim();if(probe.exitCode!==0)throw new Error(`Import canary failed: ${canary}; temporary source was not imported`);
    }
    options.signal.throwIfAborted();
    const input:VerificationInput={plan:options.plan,inputs:[...tree].map(([path,f])=>({path,digest:files.has(path)?digest(files.get(path)!):byteHash(f.bytes)})),command:{executable:options.executable,args:[...options.args],cwd:'.'},environmentDigest:digest(JSON.stringify({env:{...env,TEMP:'<scratch>',TMP:'<scratch>',TMPDIR:'<scratch>',HOME:'<scratch>',USERPROFILE:'<scratch>',PYTHONPATH:'<scratch>/src:<scratch>'},tree:[...tree.values()].sort((a,b)=>a.path.localeCompare(b.path)).map(f=>[f.path,byteHash(f.bytes),f.mode]),dependency,canary:options.importCanary??null,platform:process.platform,arch:process.arch,node:process.version}))};
    const result=await runProcess({executable:options.executable,args:options.args,cwd:directory,env,signal:options.signal,timeoutMs:timeout});
    const receipt=options.ledger.record(input,{exitCode:result.cancelled||result.overflow||!result.terminationConfirmed?-1:result.exitCode,timedOut:result.timedOut});
    return {...result,receipt,input,dependency,canary,treeFiles:tree.size};
  }finally{
    if(dirname(resolve(directory))!==tempBase||!directory.startsWith(join(tempBase,'milo-verify-')))throw new Error('Unsafe cleanup path');
    await rm(directory,{recursive:true,force:true,maxRetries:2});
  }
}

/** Changed tests run on both copies; only non-test production changes are reverted in the base. */
export async function verifyDifferential(options:VerifyOptions){
  const isTest=(p:string)=>/(?:^|\/)(?:tests?\/|test_[^/]*|[^/]*[._]test\.)/.test(p);
  if(!options.plan.changes.some(f=>isTest(f.path)))throw new Error('Differential verification requires a changed test');
  const baseChanges=options.plan.changes.map(f=>isTest(f.path)?f:{...f,after:f.before});
  const source=new Map(baseChanges.map(f=>[f.path,f.after]));
  const base=await verifySnapshot({...options,plan:{...options.plan,changes:baseChanges},files:options.files.map(f=>({path:f.path,text:source.get(f.path)??f.text}))});
  const patched=await verifySnapshot(options);
  const observed=!base.cancelled&&!base.timedOut&&!base.overflow&&base.terminationConfirmed&&base.exitCode>0&&patched.receipt.status==='passed';
  return {base,patched,status:observed?'fails-on-base-passes-on-patch':'inconclusive',note:'Inspect failure output: an infrastructure failure is not proof of the intended regression.'};
}
