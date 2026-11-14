import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { Workbench } from '../core/workbench.js';
import { checkPython } from '../core/python-syntax.js';

export type Review = ReturnType<Workbench['review']>;
/** Local host capability. The remote model cannot grant itself permission to apply edits. */
export async function startBridge(options: {
  workbench: Workbench; signal: AbortSignal;
  review: (review: Review) => Promise<unknown>;
  python?: string;
}) {
  const token = randomBytes(32).toString('hex'); let active = 0; let closed = false; let submitting = false;
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer(async (req,res) => {
    const auth = Buffer.from(req.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${token}`);
    if (closed || options.signal.aborted || req.headers.origin || !/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '') || auth.length !== expected.length || !timingSafeEqual(auth,expected)) { res.writeHead(403).end(); return; }
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    if (active >= 8) { res.writeHead(429).end(); return; }
    active++;
    const mcp = new McpServer({ name: 'milo-editor', version: '0.2.0' });
    const transport = new StreamableHTTPServerTransport({});
    const run = (fn: () => unknown | Promise<unknown>) => async () => {
      try { options.signal.throwIfAborted(); const value = await fn(); options.signal.throwIfAborted(); return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }; }
      catch (e) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : 'Tool failed', repair: 'Inspect the current staged revision and read the intended range. A cancelled or frozen attempt requires a new run.' }) }] }; }
    };
    const path = z.string().min(1).max(1024); const span = z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).strict();
    mcp.registerTool('trace_exemplar',{ description: 'Discover an identifier across source, registrations, tests, docs and changelog. Heuristic candidates, not mandatory edits.', inputSchema: { symbol: z.string().regex(/^[A-Za-z_]\w{0,127}$/) }, annotations: {readOnlyHint:true} }, ({symbol}) => run(() => options.workbench.trace(symbol))());
    mcp.registerTool('read_evidence',{ description: 'Read 1–200 lines from a discovery ID at its exact revision. Returned UTF-16 span authorizes staging only there.', inputSchema: { discovery_id: z.string().uuid(), path, start_line: z.number().int().min(1), end_line: z.number().int().min(1) }, annotations: {readOnlyHint:true} }, a => run(() => options.workbench.read(a.discovery_id,a.path,a.start_line,a.end_line))());
    mcp.registerTool('stage_edit',{ description: 'Replace exact observed text in the shadow copy. No editor or disk writes. Retrace and reread after staging before another edit.', inputSchema: { path, revision: z.string().regex(/^[a-f0-9]{64}$/), span, expected: z.string().max(128000), replacement: z.string().max(128000) }, annotations: {destructiveHint:false} }, a => run(() => options.workbench.stage(a))());
    mcp.registerTool('pack_context',{ description: 'Return four-fidelity context under a serialized UTF-8 byte budget, with inclusion/pruning reasons. Bytes are not provider tokens.', inputSchema: { budget_bytes: z.number().int().min(2).max(128000) }, annotations:{readOnlyHint:true} }, a => run(() => options.workbench.context(a.budget_bytes))());
    mcp.registerTool('submit_for_review',{ description: 'Validate Python syntax and freeze changes for local human hunk review. Runtime approval alone never authorizes editor changes.', inputSchema:{}, annotations:{destructiveHint:false} }, () => run(async () => {
      if (submitting) throw new Error('Review already pending'); submitting = true;
      try {
        const staged=options.workbench.changedFiles();
        for (const f of staged.filter(f => f.path.endsWith('.py'))) {
          const result = await checkPython(f.text,{signal:options.signal,...(options.python ? {executable:options.python} : {})});
          options.signal.throwIfAborted();
          if (result.status !== 'valid') throw new Error(`${f.path}: ${result.message}`);
        }
        options.signal.throwIfAborted();
        const latest=options.workbench.changedFiles();
        if(latest.length!==staged.length||latest.some((f,i)=>f.path!==staged[i]?.path||f.text!==staged[i]?.text))throw new Error('Staged revision changed during validation; submit again');
        return await options.review(options.workbench.review());
      } finally { submitting = false; }
    })());
    let finished = false;
    const cleanup = () => { if (finished) return; finished = true; active--; void transport.close(); void mcp.close(); };
    res.on('close',cleanup);
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const c of req) { size += c.length; if (size > 512000) { res.writeHead(413).end(); return; } chunks.push(c); }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      await mcp.connect(transport); await transport.handleRequest(req,res,body);
    } catch { if (!res.headersSent) res.writeHead(400).end('Invalid MCP request'); else res.end(); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.on('connection',socket => { sockets.add(socket); socket.on('close',() => sockets.delete(socket)); });
  await new Promise<void>((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Bridge did not bind');
  const close = async () => { closed = true; options.workbench.cancel(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); options.signal.removeEventListener('abort',abort); };
  const abort = () => { void close(); }; options.signal.addEventListener('abort',abort,{once:true});
  if (options.signal.aborted) await close();
  return { url: `http://127.0.0.1:${address.port}/mcp`, token, close };
}
