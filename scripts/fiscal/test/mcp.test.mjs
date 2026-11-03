import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFiscalMcp } from '../mcp.mjs';
import { FiscalClient } from '../client.mjs';

const id = '00000000-0000-4000-8000-000000000002';

async function connect(t, options = {}) {
  const api = new FiscalClient({ baseUrl: 'https://example.com', token: 'secret', tenantId: id, ...options });
  const server = createFiscalMcp(api);
  const client = new Client({ name: 'fiscal-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  return { api, client };
}

test('MCP defaults to reading; emission and reconciliation require operator opt-in', async t => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();
  assert.ok(tools.some(tool => tool.name === 'fiscal_nfe_status'));
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint === true));
  assert.ok(!tools.some(tool => tool.name === 'fiscal_nfe_issue'));
  const result = await client.callTool({ name: 'fiscal_nfe_issue', arguments: {} });
  assert.equal(result.isError, true);
});

test('MCP validates UUID, extra properties, and explicit confirmation before calling API', async t => {
  const { api, client } = await connect(t, { allowWrites: true });
  let calls = 0;
  api.issue = async args => { calls++; return { status: 202, data: { id: args.id, status: 'unknown' } }; };
  for (const args of [
    { id, revision: 1, idempotencyKey: id },
    { id: '../config', revision: 1, idempotencyKey: id, confirm: true },
    { id, revision: 1, idempotencyKey: id, confirm: true, tenantId: id },
  ]) assert.equal((await client.callTool({ name: 'fiscal_nfe_issue', arguments: args })).isError, true);
  assert.equal(calls, 0);
  const result = await client.callTool({ name: 'fiscal_nfe_issue', arguments: { id, revision: 1, idempotencyKey: id, confirm: true } });
  assert.equal(calls, 1);
  assert.equal(result.structuredContent.data.status, 'unknown');
  const { tools } = await client.listTools();
  assert.equal(tools.find(tool => tool.name === 'fiscal_nfe_consult_sefaz').annotations.readOnlyHint, false);
});
