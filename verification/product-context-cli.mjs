import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assessContracts } from './contracts.mjs';
import { discover } from './discovery.mjs';
import { buildProductContext, contextMarkdown, contextSourcePaths, selectProductFlows, sha256, stableJson } from './product-context.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function gitState() {
  const run = args => execFileSync('git', args, { cwd: root, windowsHide: true });
  return {
    commit: run(['rev-parse', 'HEAD']).toString('utf8').trim(),
    status: run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']),
  };
}

export async function readContextFile(repository, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.isAbsolute(relative)
      || relative.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))
      || !/\.(?:json|ya?ml|toml|lock|rs|sql|tsx?|jsx?|mjs|md)$/.test(relative)) {
    throw new Error('A referência de contexto precisa ser um arquivo de fonte relativo ao repositório');
  }
  let current = repository;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) throw new Error(`Referência indireta ou inválida: ${relative}`);
  }
  return readFile(current);
}

async function manifest(paths) {
  return Promise.all(paths.map(async file => ({ path: file, sha256: sha256(await readContextFile(root, file)) })));
}

export async function createContext(target = null) {
  const before = gitState();
  const catalogueBytes = await readContextFile(root, 'verification/contracts.json');
  const catalogue = JSON.parse(catalogueBytes.toString('utf8'));
  const definitions = selectProductFlows(catalogue, target);
  const inventory = await discover(root);
  const assessment = assessContracts(catalogue, inventory);
  if (assessment.findings.length) throw new Error(`Catálogo inconsistente: ${assessment.findings.map(item => item.code).join(', ')}`);
  const paths = contextSourcePaths(catalogue, inventory, definitions);
  const files = await manifest(paths);
  const context = buildProductContext(catalogue, inventory, {
    repository: 'avilaops/erp-next', commit: before.commit, dirty: before.status.length > 0,
    gitStatusSha256: sha256(before.status), catalogSha256: sha256(catalogueBytes),
    inventorySha256: inventory.sourceHash, contextFiles: files,
  }, target);
  const inventoryAfter = await discover(root);
  const filesAfter = await manifest(paths);
  const after = gitState();
  if (before.commit !== after.commit || !before.status.equals(after.status)
      || inventory.sourceHash !== inventoryAfter.sourceHash || stableJson(files) !== stableJson(filesAfter)) {
    throw new Error('As fontes mudaram durante a captura. Nenhum contexto foi publicado; execute novamente com o checkout estável');
  }
  return context;
}

export async function writeImmutable(file, bytes) {
  try { await writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if ((await lstat(file)).isSymbolicLink() || !(await readFile(file)).equals(Buffer.from(bytes))) throw new Error('O artefato existente difere do conteúdo esperado e foi preservado');
  }
}

async function main() {
  const { values } = parseArgs({ options: { flow: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    console.log('pnpm context:erp [--flow users|products|purchase_payment_chain|OUTRA_IDENTIDADE]\nGera contexto de fontes e contratos; não inicia serviços, não publica no laboratório e não afirma execução.');
    return;
  }
  const context = await createContext(values.flow || null);
  const destination = path.join(root, 'artifacts/product-context', context.contentSha256);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await writeImmutable(path.join(destination, 'context.json'), stableJson(context));
  await writeImmutable(path.join(destination, 'context.md'), contextMarkdown(context));
  console.log(JSON.stringify({
    schemaVersion: context.schemaVersion, contentSha256: context.contentSha256,
    commit: context.source.commit, dirty: context.source.dirty,
    targetFlow: context.selection.targetFlow, flows: context.flows.length, actions: context.actions.length,
    pendingGroups: context.pendingFlows.length, publication: 'not_observed', execution: 'not_observed',
    output: path.relative(root, destination).split(path.sep).join('/'),
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Contexto não gerado: ${error.message}`); process.exitCode = 1; });
}
