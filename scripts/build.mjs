import { build } from 'esbuild';
import { readFile,readdir,writeFile } from 'node:fs/promises';
import { dirname,resolve,join } from 'node:path';
const built=await build({entryPoints:['src/extension.ts'],outfile:'dist/extension.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',external:['vscode'],sourcemap:true,metafile:true,logLevel:'info'});
const notices=new Map();
for(const input of Object.keys(built.metafile.inputs).filter(p=>p.includes('node_modules'))){
  let dir=dirname(resolve(input));
  while(dirname(dir)!==dir){
    try{
      const pkg=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));
      if(!pkg.name){dir=dirname(dir);continue;}
      const key=`${pkg.name}@${pkg.version}`;
      if(!notices.has(key)){
        const names=(await readdir(dir)).filter(n=>/^(?:licen[sc]e|notice|copyright)(?:\.|$)/i.test(n));
        const texts=await Promise.all(names.map(n=>readFile(join(dir,n),'utf8').catch(()=>'')));
        notices.set(key,`${key} (${pkg.license??'license in upstream package'})\n${texts.join('\n')}`);
      }
      break;
    }catch{dir=dirname(dir);}
  }
}
await writeFile('dist/THIRD-PARTY-NOTICES.txt',[...notices].sort(([a],[b])=>a.localeCompare(b)).map(([,text])=>text).join('\n\n--------------------\n\n'));
if(process.argv.includes('--editor-test'))await build({entryPoints:['tests/editor-host.ts'],outfile:'dist/editor-test.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',external:['vscode'],logLevel:'info'});
if(process.argv.includes('--review-ui'))await build({entryPoints:['tests/review-ui-host.ts'],outfile:'dist/review-ui-test.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',external:['vscode'],logLevel:'info'});
if(process.argv.includes('--contract'))await build({entryPoints:['scripts/edge-contract.ts'],outfile:'.runtime/edge-contract.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',logLevel:'info'});
if(process.argv.includes('--evaluation'))await build({entryPoints:['scripts/model-evaluation.ts'],outfile:'.runtime/model-evaluation.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',logLevel:'info'});
