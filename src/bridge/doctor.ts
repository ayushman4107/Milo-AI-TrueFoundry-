import {runProcess} from '../core/process.js';
export type DoctorCheck={name:string;status:'pass'|'fail'|'unknown';detail:string;fix:string};
export async function setupDoctor(options:{baseUrl:string;models:readonly string[];python:string;root?:string}){
  const checks:DoctorCheck[]=[];checks.push({name:'Node',status:Number(process.versions.node.split('.')[0])>=22?'pass':'fail',detail:process.version,fix:'Use current VS Code and Node >=22.14 for builds.'});
  const url=new URL(options.baseUrl);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw new Error('Doctor only probes a local TrueForge origin');
  let providers:unknown;
  try{const health=await fetch(`${url.origin}/healthz`,{signal:AbortSignal.timeout(3000)});checks.push({name:'TrueForge',status:health.ok?'pass':'fail',detail:`HTTP ${health.status}`,fix:'Start the pinned TrueForge runtime in the same environment as the extension.'});
    const r=await fetch(`${url.origin}/api/v1/settings/model-providers`,{signal:AbortSignal.timeout(3000)});if(r.ok)providers=await r.json();
  }catch{checks.push({name:'TrueForge',status:'fail',detail:'Local runtime unreachable',fix:'Start TrueForge; Windows and WSL loopback differ. Use Remote WSL with a WSL runtime.'});}
  // Never return provider auth/config objects. Only names and model identifiers are extracted.
  const discovered:string[]=[];
  function names(value:unknown,parent=''){if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const item of value)names(item,parent);return;}const obj=value as Record<string,unknown>;
    const own=typeof obj.name==='string'?obj.name:parent;
    if(Array.isArray(obj.models))for(const model of obj.models){if(model&&typeof model==='object'&&'name' in model&&typeof model.name==='string')discovered.push(`${own}/${model.name}`);}
    for(const key of ['data','items','manifest','providers'])if(obj[key])names(obj[key],own);
  }names(providers);
  checks.push({name:'Models',status:options.models.length?discovered.length?(options.models.every(m=>discovered.includes(m))?'pass':'fail'):'unknown':'fail',detail:discovered.length?discovered.join(', '):'No provider model names discovered',fix:'Configure models/credentials in TrueForge, then set milo.models to their exact provider/model names.'});
  const python=await runProcess({executable:options.python,args:['--version'],timeoutMs:3000});checks.push({name:'Python',status:python.exitCode===0?'pass':'fail',detail:python.output.trim(),fix:'Set milo.pythonExecutable to a trusted installed Python interpreter.'});
  const git=await runProcess({executable:'git',args:options.root?['-C',options.root,'rev-parse','--show-toplevel']:['--version'],timeoutMs:3000});checks.push({name:'Git repository',status:git.exitCode===0?'pass':'fail',detail:git.output.trim(),fix:'Install Git and open the repository root.'});
  checks.push({name:'MCP loopback permission',status:'unknown',detail:'Reachability alone does not prove server outbound-loopback policy. A successful tool call is required.',fix:'Allow 127.0.0.1/localhost in TrueForge outbound policy and run both components in the same network namespace.'});
  return checks;
}
