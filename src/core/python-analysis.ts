import { runProcess } from './process.js';
import { validateText,LIMITS } from './validation.js';

export type PythonAnalysis={status:'valid'|'invalid'|'unavailable';message?:string;symbols?:{name:string;scope:string;suggestions:string[]}[];nodes?:{name:string;start:number;end:number;line:number;docstring:string|null;parameters:string[]}[];ast?:string;tokens?:string;imports?:string[]};
const SCRIPT=String.raw`import ast,symtable,tokenize,io,json,sys,builtins,difflib,hashlib
data=json.loads(sys.stdin.buffer.read().decode('utf8')); original=data['text']; bom=1 if original.startswith('\ufeff') else 0; source=original[1:] if bom else original
try:
 tree=ast.parse(source,type_comments=True); table=symtable.symtable(source,'<staged>','exec'); globals_={s.get_name() for s in table.get_symbols() if s.is_assigned() or s.is_imported() or s.is_namespace()}; known=globals_|set(dir(builtins))|{'__name__','__file__','__package__','__doc__','__builtins__','__annotations__','__spec__'}; warnings=[]
 def visit(t):
  for s in t.get_symbols():
   if s.is_referenced() and s.is_global() and s.get_name() not in known:
    warnings.append({'name':s.get_name(),'scope':t.get_name(),'suggestions':difflib.get_close_matches(s.get_name(),sorted(known|set(data.get('repoNames',[]))),n=3,cutoff=0.65)})
  for c in t.get_children(): visit(c)
 visit(table)
 lines=source.splitlines(keepends=True)
 def off(line,col):
  prefix=''.join(lines[:line-1])+lines[line-1].encode('utf8')[:col].decode('utf8'); return bom+len(prefix.encode('utf-16-le'))//2
 nodes=[]
 for n in ast.walk(tree):
  if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):
   start=min([n.lineno]+[d.lineno for d in n.decorator_list]); params=[a.arg for a in n.args.args] if hasattr(n,'args') else []
   nodes.append({'name':n.name,'start':off(start,0),'end':off(n.end_lineno,n.end_col_offset),'line':start,'docstring':(ast.get_docstring(n) or '')[:600] or None,'parameters':params})
 tokens=[(t.type,t.string) for t in tokenize.generate_tokens(io.StringIO(source).readline) if t.type not in (tokenize.INDENT,tokenize.DEDENT,tokenize.NL,tokenize.NEWLINE,tokenize.ENDMARKER)]
 imports=[n.module or '' for n in ast.walk(tree) if isinstance(n,ast.ImportFrom)]+[a.name for n in ast.walk(tree) if isinstance(n,ast.Import) for a in n.names]
 print(json.dumps({'status':'valid','symbols':warnings[:64],'nodes':nodes[:256],'ast':hashlib.sha256(ast.dump(tree,include_attributes=False).encode()).hexdigest(),'tokens':hashlib.sha256(repr(tokens).encode()).hexdigest(),'imports':imports[:128]}))
except (SyntaxError,ValueError,RecursionError) as e: print(json.dumps({'status':'invalid','message':str(e)[:500]}))
`;
export async function analyzePython(text:string,options:{python?:string;signal?:AbortSignal;repoNames?:readonly string[]}={}):Promise<PythonAnalysis>{
  validateText(text);if(text.length>LIMITS.file)throw new Error('Analysis file limit');
  const result=await runProcess({executable:options.python??process.env.MILO_PYTHON??(process.platform==='win32'?'python':'python3'),args:['-I','-S','-c',SCRIPT],input:JSON.stringify({text,repoNames:(options.repoNames??[]).slice(0,20000)}),timeoutMs:5000,maxBytes:256000,...(options.signal?{signal:options.signal}:{})});
  if(result.exitCode!==0||result.overflow||result.cancelled)return {status:'unavailable',message:'Python analysis unavailable'};
  try{return JSON.parse(result.output) as PythonAnalysis;}catch{return {status:'unavailable',message:'Malformed parser result'};}
}
export function enclosingNode(analysis:PythonAnalysis,start:number,end:number){return analysis.nodes?.filter(n=>n.start<=start&&n.end>=end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];}
