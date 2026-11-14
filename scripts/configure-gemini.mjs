import{readFile}from'node:fs/promises';
const base=new URL(process.env.TRUEFORGE_BASE_URL??'http://127.0.0.1:18790');
if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new Error('Use a local TrueForge origin');
if(!process.env.MILO_GEMINI_KEY_FILE)throw new Error('Set MILO_GEMINI_KEY_FILE to a private file outside the repository');
const body=JSON.parse(await readFile(new URL('../examples/trueforge-model-provider.json',import.meta.url),'utf8'));
body.manifest.auth.api_key=(await readFile(process.env.MILO_GEMINI_KEY_FILE,'utf8')).trim();if(!body.manifest.auth.api_key)throw new Error('Empty credential file');
if(process.argv.includes('--paced'))body.manifest.base_url='http://127.0.0.1:18791/v1beta';
const endpoint=new URL('/api/v1/settings/model-providers',base);
// POST creates, PUT replaces. Never print the registry or credential-bearing request.
let response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
if(response.status===409)response=await fetch(endpoint,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
if(!response.ok)throw new Error(`Provider configuration HTTP ${response.status}; inspect local TrueForge settings`);
console.log('Configured google-gemini/flash and google-gemini/flash-lite. No generation request made.');
