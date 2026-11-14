import type { FileChange } from './change-batch.js';
import { analyzePython } from './python-analysis.js';

export type Requirement={id:'tests'|'docs'|'help';label:string;status:'evidence'|'missing';paths:string[];explanation:string};
export function fileRole(path:string):'source'|'tests'|'docs'{return /(?:^|\/)(?:tests?\/|test_[^/]*|[^/]*[._]test\.)/.test(path)?'tests':/(?:^|\/)(?:docs?\/|readme|changes|changelog)|\.(?:md|rst)$/i.test(path)?'docs':'source';}
export function requirements(request:string,changes:readonly FileChange[]):Requirement[]{
  const added=(f:FileChange)=>{const before=new Set(f.before.split(/\r?\n/));return f.after.split(/\r?\n/).filter(l=>!before.has(l)).join('\n');};
  const wanted:{id:Requirement['id'];label:string;pattern:RegExp;check:(f:FileChange)=>boolean;explanation:string}[]=[
    {id:'tests',label:'Test coverage requested',pattern:/\btests?\b|\bcoverage\b/i,check:f=>fileRole(f.path)==='tests'&&f.before!==f.after,explanation:'A test-file change is evidence, not a passing test or coverage measurement.'},
    {id:'docs',label:'Documentation requested',pattern:/\bdocs?\b|\bdocument(?:ation|ed)?\b|\breadme\b/i,check:f=>fileRole(f.path)==='docs'&&f.before!==f.after,explanation:'Documentation file changed; content still needs review.'},
    {id:'help',label:'Help visibility requested',pattern:/--help|\bhelp (?:text|output|command)\b/i,check:f=>/add_command|register|\.command\(|help\s*=/.test(added(f)),explanation:'Registration/help syntax found in changed lines. Execute --help to verify behavior.'},
  ];
  return wanted.filter(w=>w.pattern.test(request)&&!new RegExp(`(?:do not|don't|without|no)\\s+(?:change\\s+|add\\s+)?(?:${w.id==='tests'?'tests?':w.id==='docs'?'docs?|documentation':'--help|help'})`,'i').test(request)).map(w=>{const paths=changes.filter(w.check).map(f=>f.path);return {id:w.id,label:w.label,status:paths.length?'evidence':'missing',paths,explanation:w.explanation};});
}
export async function reviewQuality(changes:readonly FileChange[],options:{python?:string;signal?:AbortSignal;repoNames?:readonly string[]}={}){
  const results=[];
  for(const file of changes){let formattingOnly=false;let warnings:string[]=[];
    if(file.path.endsWith('.py')){const [before,after]=await Promise.all([analyzePython(file.before,options),analyzePython(file.after,options)]);
      formattingOnly=before.status==='valid'&&after.status==='valid'&&before.ast===after.ast&&before.tokens===after.tokens&&file.before!==file.after;
      const old=new Set(before.symbols?.map(s=>`${s.scope}:${s.name}`));warnings=(after.symbols??[]).filter(s=>!old.has(`${s.scope}:${s.name}`)).map(s=>`${s.name} unresolved in ${s.scope}${s.suggestions.length?`; nearby: ${s.suggestions.join(', ')}`:''}`);
      if(after.status!=='valid')warnings.push(after.message??'Python analysis unavailable');
    }
    results.push({path:file.path,role:fileRole(file.path),formattingOnly,warnings});
  }
  return results;
}

/** Only preserve edits outside a unique exact changed block; ambiguous or overlapping text conflicts. */
export function rebaseChange(file:FileChange,current:string):FileChange{
  if(current===file.before)return {...file};
  let start=0;while(start<file.before.length&&start<file.after.length&&file.before[start]===file.after[start])start++;
  let suffix=0;while(suffix<file.before.length-start&&suffix<file.after.length-start&&file.before[file.before.length-1-suffix]===file.after[file.after.length-1-suffix])suffix++;
  const old=file.before.slice(start,file.before.length-suffix);const replacement=file.after.slice(start,file.after.length-suffix);
  const left=file.before.slice(Math.max(0,start-80),start);const right=file.before.slice(file.before.length-suffix,file.before.length-suffix+80);
  const anchor=left+old+right;if(!anchor)throw new Error(`Ambiguous empty rebase: ${file.path}`);
  const at=current.indexOf(anchor);if(at<0||current.indexOf(anchor,at+1)>=0)throw new Error(`Review conflict: ${file.path}`);
  const pos=at+left.length;return {path:file.path,before:current,after:current.slice(0,pos)+replacement+current.slice(pos+old.length)};
}
