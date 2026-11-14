// The provider is deliberately scripted: this measures the real harness, not model quality.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { TrueForge, isEventDelta, mergeEventDelta } from '@truefoundry/trueforge-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://127.0.0.1:18790';
const host = new URL(baseUrl).hostname;
assert(['localhost', '127.0.0.1', '[::1]'].includes(host), 'Run against a disposable local TrueForge instance only');
const prefix = `milo-probe-${randomUUID()}`;
const probeToken = randomBytes(32).toString('hex');
const deadline = AbortSignal.timeout(90_000);
const results = { kind: 'scripted-provider-real-trueforge', baseUrl, checks: [], sessions: [] };
const client = new TrueForge({ baseUrl, timeoutInSeconds: 10, maxRetries: 0, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]) }) });
const cleanupClient = new TrueForge({ baseUrl, timeoutInSeconds: 3, maxRetries: 0 });
let executed = 0;
let mode = 'tool';
let toolStyle = 'direct';
let lastTools = [];
let slowRequested;
let slowToolStarted;
let toolDelay = 0;
let executionAllowed = true;

async function json(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Probe body limit');
  }
  return body ? JSON.parse(body) : undefined;
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
async function api(path, body, method = 'POST') {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0,700)}`);
  return text ? JSON.parse(text) : {};
}

const mcp = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${probeToken}` || req.headers.origin) { res.writeHead(403).end(); return; }
  if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  const server = new McpServer({ name: prefix, version: '0.1.0' });
  server.registerTool('review_changes', {
    description: 'Approve a synthetic batch. This research tool changes no files.',
    inputSchema: { batch_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async () => {
    if (toolDelay) { slowToolStarted?.(); await new Promise(resolve => setTimeout(resolve, toolDelay)); }
    if (!executionAllowed) return { isError: true, content: [{ type: 'text', text: 'Local run revoked' }] };
    executed++; return { content: [{ type: 'text', text: 'synthetic batch reviewed' }] };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { void transport.close(); void server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, await json(req)); }
  catch (error) { if (!res.headersSent) res.writeHead(500).end(String(error)); }
});

const provider = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${probeToken}` || req.headers.origin) { res.writeHead(403).end(); return; }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  try {
    const body = await json(req);
    if (mode === 'unauthorized') {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Synthetic invalid credential', type: 'authentication_error', code: 'invalid_api_key' } }));
      return;
    }
    if (mode === 'slow') {
      slowRequested?.();
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const timer = setInterval(() => res.write(': waiting\n\n'), 200);
      res.on('close', () => clearInterval(timer));
      return;
    }
    if (body.stream === false) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'summary-probe', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: 'Synthetic summary. Continue the contract probe.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
      return;
    }
    lastTools = (body.tools ?? []).map(t => t.function.name);
    const needsTool = mode !== 'text' && !body.messages.some(m => m.role === 'tool');
    const toolName = lastTools.find(n => n.includes(toolStyle === 'deferred' ? 'call_tool' : 'review_changes'));
    if (needsTool && !toolName) throw new Error(`Expected tool absent: ${lastTools.join(', ')}`);
    const args = toolStyle === 'deferred'
      ? { mcp_server: prefix, tool_name: 'review_changes', input: { batch_id: 'synthetic' } }
      : { batch_id: 'synthetic' };
    const delta = needsTool
      ? { tool_calls: [{ index: 0, id: `call_${randomUUID()}`, type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } }] }
      : { content: 'Harness contract completed.' };
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const chunk = (d, finish_reason = null) => ({ id: 'chatcmpl-probe', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: body.model, choices: [{ index: 0, delta: d, finish_reason }] });
    res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', ...delta }))}\n\n`);
    res.write(`data: ${JSON.stringify(chunk({}, needsTool ? 'tool_calls' : 'stop'))}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (error) { if (!res.headersSent) res.writeHead(500).end(String(error)); }
});

async function openSession(deferred = false, compact = false) {
  const { data } = await client.sessions.create({ agent: { spec: {
    model: { name: `${prefix}/scripted` }, instructions: 'Exercise the research MCP tool once.',
    mcpServers: [{ name: prefix, preload: !deferred, requireApprovalForTools: ['review_changes'] }],
    config: { sandbox: { enabled: false }, dynamicSubAgents: { enabled: false }, generativeUi: { enabled: false }, askUserQuestions: { enabled: false }, iterationLimit: 5, ...(compact ? { contextManagement: { compaction: { enabled: true, trigger: { type: 'input_tokens', value: 1500 } } } } : {}) },
  } } });
  results.sessions.push(data.id);
  return data.id;
}
async function runUntil(sessionId, stop, content = 'Review the synthetic batch.') {
  const events = new Map();
  let turnId;
  let paused;
  const stream = await client.sessions.createTurnStream(sessionId, { input: [{ type: 'user.message', content }] });
  for await (const event of stream) {
    if (isEventDelta(event)) { const base = events.get(event.id); if (base) mergeEventDelta(base, event); }
    else events.set(event.id, event);
    if (event.type === 'turn.created') turnId = event.turnId;
    if (event.type === 'tool.approval_required') paused = event;
    if (await stop(event, { turnId, paused, events })) return { event, turnId, paused, events };
    if (event.type === 'turn.done') throw new Error(`Unexpected terminal state before checkpoint: ${JSON.stringify(event.state)}`);
  }
  throw new Error('Stream ended before expected state');
}

let registered = false;
try {
  const health = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
  assert(health.ok, 'TrueForge must be healthy');
  const mcpPort = await listen(mcp);
  const providerPort = await listen(provider);
  await api('/settings/model-providers', { manifest: { type: 'custom', name: prefix, auth: { api_key: probeToken }, base_url: `http://127.0.0.1:${providerPort}/v1`, models: [{ name: 'scripted', model_id: 'scripted', properties: { context_length: 16000 } }] } });
  registered = true;
  await api('/settings/mcp-servers', { manifest: { type: 'remote', name: prefix, description: 'Milo isolated contract probe', url: `http://127.0.0.1:${mcpPort}/mcp`, auth: { type: 'header', headers: { Authorization: `Bearer ${probeToken}` } } } });
  const unauthorized = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, { method: 'POST', body: '{}' });
  assert.equal(unauthorized.status, 403);
  const browserRequest = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${probeToken}`, Origin: 'https://untrusted.example' }, body: '{}' });
  assert.equal(browserRequest.status, 403);
  results.checks.push({ check: 'MCP probe rejects missing credentials and browser origins', status: 'passed' });

  for (const { deferred, allow } of [{ deferred: false, allow: true }, { deferred: true, allow: true }, { deferred: false, allow: false }]) {
    toolStyle = deferred ? 'deferred' : 'direct';
    const sessionId = await openSession(deferred);
    const before = executed;
    const state = await runUntil(sessionId, e => e.type === 'turn.update' && e.state.status === 'paused');
    assert(state.paused && state.turnId);
    assert.equal(executed, before, 'Gated tool must not execute before approval');
    const approval = state.paused.toolCalls[0];
    const resume = await client.sessions.subscribeToTurn(sessionId, state.turnId, { afterEventId: state.event.id });
    await client.sessions.createTurnEvents(sessionId, state.turnId, { events: [{ type: 'user.tool_approval', threadId: state.paused.threadId, toolCallId: approval.id, approval: allow ? { status: 'allow' } : { status: 'deny', reason: 'Probe rejection' } }] });
    let final;
    for await (const event of resume) if (event.type === 'turn.done') { final = event; break; }
    assert.equal(final?.state.status, 'done');
    assert.equal(executed, before + (allow ? 1 : 0));
    results.checks.push({ check: !allow ? 'denial never executes MCP handler' : deferred ? 'deferred approval round-trip' : 'direct approval round-trip', status: 'passed', toolSchemas: lastTools });
  }

  toolStyle = 'direct';
  const pausedSession = await openSession();
  const beforeCancel = executed;
  const paused = await runUntil(pausedSession, e => e.type === 'turn.update' && e.state.status === 'paused');
  const t0 = performance.now();
  await client.sessions.cancel(pausedSession);
  const cancelled = await client.sessions.getTurn(pausedSession, paused.turnId);
  assert.equal(cancelled.data.state.status, 'cancelled');
  assert.equal(executed, beforeCancel);
  results.checks.push({ check: 'cancel paused approval without executing tool', status: 'passed', elapsedMs: Math.round(performance.now()-t0) });
  await assert.rejects(client.sessions.createTurnEvents(pausedSession, paused.turnId, { events: [{ type: 'user.tool_approval', threadId: paused.paused.threadId, toolCallId: paused.paused.toolCalls[0].id, approval: { status: 'allow' } }] }));
  assert.equal(executed, beforeCancel);
  results.checks.push({ check: 'late approval cannot resume a cancelled turn', status: 'passed' });

  toolDelay = 300;
  const delayedSession = await openSession();
  const delayed = await runUntil(delayedSession, e => e.type === 'turn.update' && e.state.status === 'paused');
  const toolStarted = new Promise(resolve => { slowToolStarted = resolve; });
  const delayedStream = await client.sessions.subscribeToTurn(delayedSession, delayed.turnId, { afterEventId: delayed.event.id });
  await client.sessions.createTurnEvents(delayedSession, delayed.turnId, { events: [{ type: 'user.tool_approval', threadId: delayed.paused.threadId, toolCallId: delayed.paused.toolCalls[0].id, approval: { status: 'allow' } }] });
  await Promise.race([toolStarted, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Slow MCP handler not reached')), 5000); timer.unref(); })]);
  const delayedBefore = executed;
  executionAllowed = false;
  await client.sessions.cancel(delayedSession);
  let delayedFinal;
  for await (const event of delayedStream) if (event.type === 'turn.done') { delayedFinal = event; break; }
  assert.equal(delayedFinal?.state.status, 'cancelled');
  assert.equal(executed, delayedBefore);
  results.checks.push({ check: 'local fence prevents late MCP action during cancellation', status: 'passed' });
  toolDelay = 0; executionAllowed = true;

  mode = 'unauthorized';
  const failedSession = await openSession();
  const failStart = performance.now();
  const failed = await runUntil(failedSession, e => e.type === 'turn.done');
  assert.equal(failed.event.state.status, 'error');
  results.checks.push({ check: 'provider 401 becomes terminal turn error', status: 'passed', elapsedMs: Math.round(performance.now()-failStart), state: failed.event.state });

  mode = 'slow';
  const slowSession = await openSession();
  const started = new Promise(resolve => { slowRequested = resolve; });
  const pending = runUntil(slowSession, e => e.type === 'turn.done');
  await Promise.race([started, pending.then(() => { throw new Error('Stream ended before reaching slow provider'); }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Slow provider was not reached')), 8000); timer.unref(); })]);
  const cancelStart = performance.now();
  await client.sessions.cancel(slowSession);
  const slowFinal = await pending;
  assert.equal(slowFinal.event.state.status, 'cancelled');
  results.checks.push({ check: 'cancel active provider stream', status: 'passed', elapsedMs: Math.round(performance.now()-cancelStart) });

  mode = 'text';
  const compactSession = await openSession(false, true);
  const compact = await runUntil(compactSession, e => e.type === 'turn.done', 'Bounded context test. '.repeat(1000));
  assert.equal(compact.event.state.status, 'done');
  const compactionEvents = [...compact.events.values()].filter(e => e.type.includes('compaction'));
  assert(compactionEvents.length >= 2, 'Compaction start and finish events must be visible');
  results.checks.push({ check: 'compaction without sandbox', status: 'passed', eventTypes: compactionEvents.map(e => e.type) });

  console.log(JSON.stringify(results, null, 2));
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/runtime-contract.json', JSON.stringify(results, null, 2));
} finally {
  for (const sessionId of results.sessions) await cleanupClient.sessions.cancel(sessionId).catch(() => {});
  if (registered) {
    await api(`/settings/mcp-servers/${prefix}`, undefined, 'DELETE').catch(() => {});
    await api(`/settings/model-providers/${prefix}`, undefined, 'DELETE').catch(() => {});
  }
  mcp.closeAllConnections(); provider.closeAllConnections();
  mcp.close(); provider.close();
}
