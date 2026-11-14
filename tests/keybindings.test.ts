import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('keybindings target declared commands, gate focus and avoid common default shortcuts',async()=>{
 const pkg=JSON.parse(await readFile('package.json','utf8'));const names=new Set(pkg.contributes.commands.map((c:{command:string})=>c.command));
 const common=new Set(['ctrl+c','ctrl+v','ctrl+x','ctrl+z','ctrl+y','ctrl+a','ctrl+s','ctrl+p','ctrl+shift+p','ctrl+k ctrl+c','ctrl+k ctrl+u','ctrl+k ctrl+s','escape','enter']);const seen=new Set();
 for(const b of pkg.contributes.keybindings){assert(names.has(b.command));assert(b.when?.length);assert(!common.has(b.key));assert(!seen.has(b.key));seen.add(b.key);assert(b.mac);if(b.command==='milo.inline')assert.match(b.when,/editorTextFocus.*editorHasSelection/);else assert.match(b.when,/!inputFocus/);if(b.command.startsWith('milo.review.'))assert.match(b.when,/milo.reviewActive/);}
 assert.equal(pkg.contributes.keybindings.length,6);
});
