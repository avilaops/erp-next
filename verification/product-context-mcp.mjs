import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createContext, writeImmutable } from './product-context-cli.mjs';
import { sha256, stableJson, validateProductContext } from './product-context.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultFlows = ['users', 'products', 'purchase_payment_chain'];

/** Transport rows are derived artifacts; canonical actions remain in contracts.json. */
export function contextBundle(contexts) {
  if (!Array.isArray(contexts) || !contexts.length) throw new Error('Informe ao menos um contexto validado');
  const seen = new Set();
  let source;
  const index = [], snapshots = [];
  for (const context of contexts) {
    const findings = validateProductContext(context);
    if (findings.length) throw new Error(`Contexto inválido para MCP: ${findings.map(item => item.code).join(', ')}`);
    const target = context.selection.targetFlow;
    if (!target || seen.has(target)) throw new Error('Cada captura MCP precisa selecionar uma funcionalidade distinta');
    seen.add(target);
    const { contextFiles, ...identity } = context.source;
    if (source && stableJson(source) !== stableJson(identity)) throw new Error('As capturas pertencem a estados de fonte diferentes; gere novamente');
    source = identity;
    const selected = context.flows.find(flow => flow.definition.id === target);
    if (!selected || !context.selection.includedFlows.includes(target)) throw new Error('A funcionalidade selecionada não está no contexto');
    index.push({
      flow: target, title: selected.definition.title, content_sha256: context.contentSha256,
      source_commit: context.source.commit, source_dirty: context.source.dirty,
      source_fingerprint: context.source.inventorySha256, schema_version: context.schemaVersion,
      flow_count: context.flows.length, action_count: context.actions.length,
      included_flows: JSON.stringify(context.selection.includedFlows),
      publication: 'not_observed', execution: 'not_observed',
    });
    snapshots.push({ content_sha256: context.contentSha256, context_json: stableJson(context) });
  }
  index.sort((a, b) => a.flow.localeCompare(b.flow, 'en'));
  snapshots.sort((a, b) => a.content_sha256.localeCompare(b.content_sha256, 'en'));
  const payload = { schemaVersion: 'erp-mcp-context-bundle/1', source, tables: { index, snapshots } };
  return { ...payload, bundleSha256: sha256(stableJson(payload)) };
}

async function main() {
  const { values } = parseArgs({ options: { flow: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    console.log('pnpm context:erp:mcp [--flow users --flow products]\nGera linhas para o índice e as capturas MCP. Não importa no n8n, não publica o ERP e não comprova execução.');
    return;
  }
  const contexts = [];
  for (const flow of values.flow || defaultFlows) contexts.push(await createContext(flow));
  const bundle = contextBundle(contexts);
  const destination = path.join(root, 'artifacts/mcp-context', bundle.bundleSha256);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await writeImmutable(path.join(destination, 'bundle.json'), stableJson(bundle));
  console.log(JSON.stringify({
    schemaVersion: bundle.schemaVersion, bundleSha256: bundle.bundleSha256,
    commit: bundle.source.commit, dirty: bundle.source.dirty,
    flows: bundle.tables.index.map(row => row.flow),
    imported: false, publication: 'not_observed', execution: 'not_observed',
    output: path.relative(root, path.join(destination, 'bundle.json')).split(path.sep).join('/'),
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Contexto MCP não gerado: ${error.message}`); process.exitCode = 1; });
}
