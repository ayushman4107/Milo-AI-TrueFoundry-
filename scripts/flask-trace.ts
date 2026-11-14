import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {traceExemplar} from '../src/core/context.js';
import {Workbench} from '../src/core/workbench.js';
const root=process.argv[2];assert(root,'Supply a local Flask 3.1.3 checkout path');
const files:{path:string;text:string}[]=[];
async function walk(path=''){
  for(const entry of await readdir(join(root!,path),{withFileTypes:true})){
    if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
    const child=path?`${path}/${entry.name}`:entry.name;
    if(entry.isDirectory())await walk(child);
    else if(/\.(?:py|rst|md|toml|json|yaml|yml|txt)$/.test(child))files.push({path:child,text:await readFile(join(root!,child),'utf8')});
  }
}
await walk();const w=new Workbench(files);const hits=w.trace('routes_command');
for(const role of ['definition','registration','test','documentation','changelog'])assert(hits.some(h=>h.role===role),`Missing ${role}`);
const definition=hits.find(h=>h.role==='definition')!;w.read(definition.id,definition.path,definition.line,definition.line+20);
const pack=w.context(4000);assert(pack.bytes<=4000);
const report={kind:'retrieval-only-pinned-flask-3.1.3',files:files.length,characters:files.reduce((n,f)=>n+f.text.length,0),hits:hits.map(({id,excerpt,...h})=>h),contextBytes:pack.bytes};
await mkdir('test-results',{recursive:true});await writeFile('test-results/flask-trace.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({files:files.length,roles:[...new Set(hits.map(h=>h.role))],contextBytes:pack.bytes}));
