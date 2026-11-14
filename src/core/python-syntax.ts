import { spawn } from 'node:child_process';
import { LIMITS, validateText } from './validation.js';

export type SyntaxResult = { status: 'valid' } | { status: 'invalid'; message: string; line: number; column: number } | { status: 'unavailable'; message: string };
const SCRIPT = `import ast,json,sys
s=sys.stdin.buffer.read().decode('utf-8-sig')
try:
 ast.parse(s)
 print(json.dumps({'status':'valid'}))
except (SyntaxError,ValueError,RecursionError) as e:
 print(json.dumps({'status':'invalid','message':str(e)[:300],'line':getattr(e,'lineno',None) or 1,'column':getattr(e,'offset',None) or 1}))
`;

/** Parses in isolated Python, without executing project code or silently dedenting. */
export async function checkPython(text: string, options: { executable?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<SyntaxResult> {
  validateText(text); if (text.length > LIMITS.file) throw new Error('Python validation size limit');
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid syntax deadline');
  if (options.signal?.aborted) return { status: 'unavailable', message: 'Validation cancelled' };
  return new Promise(resolve => {
    const child = spawn(options.executable ?? process.env.MILO_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'), ['-I','-S','-c',SCRIPT], { stdio: 'pipe', windowsHide: true, shell: false });
    let output = ''; let settled = false;
    const done = (result: SyntaxResult) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); child.kill(); resolve(result); };
    const abort = () => done({ status: 'unavailable', message: 'Validation cancelled' });
    const timer = setTimeout(() => done({ status: 'unavailable', message: 'Python validation timed out' }),timeoutMs);
    options.signal?.addEventListener('abort',abort,{once:true});
    child.on('error', () => done({ status: 'unavailable', message: 'Configure a trusted Python executable; parser could not start' }));
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 8192) done({ status: 'unavailable', message: 'Parser output limit' }); });
    child.on('close', code => {
      try {
        if (code !== 0) throw new Error();
        const result = JSON.parse(output) as SyntaxResult;
        if (result.status !== 'valid' && result.status !== 'invalid') throw new Error();
        done(result);
      } catch { done({ status: 'unavailable', message: 'Parser did not return a valid result' }); }
    });
    child.stdin.end(Buffer.from(text,'utf8'));
  });
}
