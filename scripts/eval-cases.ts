export const TASK_A="Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";
export const TASK_B='Add a new built-in CLI command flask config that prints the loaded application\'s configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.';
export const CHECK_A=String.raw`import os,inspect,json
from flask.helpers import get_debug_flag
cases=[(None,False),('',False),('0',False),('false',False),('FALSE',False),('no',False),('No',False),('off',False),('OFF',False),('n',False),('N',False),('1',True),('yes',True),('true',True),(' off ',True)]
for value,expected in cases:
 if value is None: os.environ.pop('FLASK_DEBUG',None)
 else: os.environ['FLASK_DEBUG']=value
 assert get_debug_flag() is expected,(value,expected)
print(json.dumps({'cases':len(cases),'off':False,'docstring':inspect.getdoc(get_debug_flag),'note':'Docstring completeness needs review.'}))`;
export const CHECK_B=String.raw`import json,sys,subprocess
from flask import Flask
from flask.cli import cli,ScriptInfo
from click.testing import CliRunner
tests=subprocess.run([sys.executable,'-m','pytest','tests/test_cli.py','-q'])
assert tests.returncode==0,'Flask CLI pytest failed'
app=Flask('milo_benchmark')
app.config.update(SECRET_KEY='private-a',DATABASE_PASSWORD='private-b',ACCESS_TOKEN='private-c',API_KEY='private-d',PUBLIC_VALUE='visible')
original=dict(app.config); runner=CliRunner()
help_result=runner.invoke(cli,['--help']); assert help_result.exit_code==0 and 'config' in help_result.output,help_result.output
result=runner.invoke(cli,['config'],obj=ScriptInfo(create_app=lambda:app)); assert result.exit_code==0,(result.output,repr(result.exception))
data=json.loads(result.output)
assert set(data)==set(original),'Missing application config keys'
for key,value in original.items():
 if any(word in key.upper() for word in ['SECRET','PASSWORD','TOKEN','KEY']): assert data[key]=='***',key
assert data['PUBLIC_VALUE']=='visible'
assert dict(app.config)==original,'Printing config must not mutate application config'
print('MILO_MASKED_JSON '+json.dumps({k:data[k] for k in ['SECRET_KEY','DATABASE_PASSWORD','ACCESS_TOKEN','API_KEY','PUBLIC_VALUE']}))`;
export function median(values:number[]){const a=[...values].sort((a,b)=>a-b);if(!a.length)return null;const n=Math.floor(a.length/2);return a.length%2?a[n]!:((a[n-1]!+a[n]!)/2);}
export function summarize(rows:readonly Record<string,unknown>[]){return [...new Set(rows.map(r=>`${r.task}:${r.model}`))].map(key=>{const group=rows.filter(r=>`${r.task}:${r.model}`===key);const usage=group.flatMap(r=>Array.isArray(r.usage)?r.usage:[]) as {inputTokens?:number;outputTokens?:number}[];return {group:key,attempted:group.length,passed:group.filter(r=>r.status==='passed').length,quotaBlocked:group.filter(r=>r.status==='quota-blocked').length,inputTokens:usage.reduce((n,u)=>n+(u.inputTokens??0),0),outputTokens:usage.reduce((n,u)=>n+(u.outputTokens??0),0),medianReviewMs:median(group.map(r=>r.timeToDiffMs).filter((n):n is number=>typeof n==='number')),medianFailoverMs:median(group.map(r=>r.failoverMs).filter((n):n is number=>typeof n==='number')),guardrails:[...new Set(group.flatMap(r=>Array.isArray(r.guardrails)?r.guardrails as string[]:[]))]};});}
export function safeError(error:unknown){return (error instanceof Error?error.message:String(error)).replace(/(?:AIza|AQ\.)[A-Za-z0-9_-]+/g,'[redacted-key]').replace(/(Bearer\s+|api[_-]?key["'\s:=]+)[A-Za-z0-9_.-]{12,}/gi,'$1[redacted]').slice(0,4000);}
