import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createContext, writeImmutable } from './product-context-cli.mjs';
import { sha256, stableJson, validateProductContext } from './product-context.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultEndpoint = 'https://ml.avilaops.com/api/v1/product-contexts/erp';
const maximumBytes = 1024 * 1024;

export class ContextSyncError extends Error {
  constructor(code) { super(`Sincronização de contexto não confirmada (${code})`); this.code = code; }
}

export function contextImportRequestId(contentSha256, confirmPublication) {
  return sha256(stableJson({ schemaVersion: 'erp-context-import/1', contentSha256, confirmPublication }));
}

function configuration(endpoint, token) {
  let url;
  try { url = new URL(endpoint); } catch { throw new ContextSyncError('INVALID_ENDPOINT'); }
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((!local && url.href !== defaultEndpoint) || url.pathname !== '/api/v1/product-contexts/erp'
      || url.username || url.password || url.search || url.hash) throw new ContextSyncError('INVALID_ENDPOINT');
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new ContextSyncError('TOKEN_REQUIRED');
  return url;
}

async function jsonRequest(url, token, fetcher, options = {}) {
  let response;
  try {
    response = await fetcher(url, {
      redirect: 'error', signal: AbortSignal.timeout(15_000), ...options,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    let bytes = 0;
    const chunks = [];
    if (response.body) for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) throw new ContextSyncError('RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(chunk));
    }
    return { status: response.status, etag: response.headers.get('etag'), data: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch (error) { if (error instanceof ContextSyncError) throw error; throw new ContextSyncError('TRANSPORT_OR_INVALID_RESPONSE'); }
}

/** A timeout is reconciled by the request ID, never by repeating the PUT blindly. */
export async function publishContext(context, { endpoint = defaultEndpoint, token, confirmPublication = false, fetcher = fetch } = {}) {
  const url = configuration(endpoint, token);
  if (validateProductContext(context).length || context.selection.targetFlow !== null || typeof confirmPublication !== 'boolean') throw new ContextSyncError('INVALID_CONTEXT');
  if (confirmPublication && context.source.dirty) throw new ContextSyncError('DIRTY_PUBLICATION');
  const bytes = stableJson(context);
  const body = stableJson({ context, confirmPublication });
  if (Buffer.byteLength(body) > maximumBytes) throw new ContextSyncError('CONTEXT_TOO_LARGE');
  const requestId = contextImportRequestId(context.contentSha256, confirmPublication);
  const receiptUrl = new URL(url); receiptUrl.searchParams.set('requestId', requestId);
  const snapshotUrl = new URL(url); snapshotUrl.searchParams.set('sha256', context.contentSha256);
  const validateReceipt = receipt => {
    if (!receipt || receipt.requestId !== requestId || receipt.contentSha256 !== context.contentSha256
        || receipt.sourceCommit !== context.source.commit || receipt.sourceDirty !== context.source.dirty
        || receipt.execution !== 'not_observed' || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1
        || !Number.isFinite(Date.parse(receipt.importedAt))
        || (confirmPublication ? receipt.publication?.state !== 'version_observed'
          || receipt.publication.origin !== 'https://erp.avilaops.com' || receipt.publication.servedCommit !== context.source.commit
          || !Number.isFinite(Date.parse(receipt.publication.observedAt)) : receipt.publication?.state !== 'not_observed')) throw new ContextSyncError('RECEIPT_MISMATCH');
    return receipt;
  };
  const confirm = async receipt => {
    validateReceipt(receipt);
    const snapshot = await jsonRequest(snapshotUrl, token, fetcher);
    if (snapshot.status !== 200 || validateProductContext(snapshot.data).length || stableJson(snapshot.data) !== bytes) throw new ContextSyncError('READBACK_MISMATCH');
    return receipt;
  };
  const prior = await jsonRequest(receiptUrl, token, fetcher);
  if (prior.status === 200) return { receipt: await confirm(prior.data), reused: true, recovered: false };
  if (prior.status !== 404) throw new ContextSyncError(`RECEIPT_HTTP_${prior.status}`);
  const state = await jsonRequest(url, token, fetcher);
  if (state.status !== 200 || !Number.isSafeInteger(state.data.revision) || state.data.revision < 0 || state.etag !== `"${state.data.revision}"`) throw new ContextSyncError('INVALID_REVISION');
  try {
    const result = await jsonRequest(url, token, fetcher, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': state.etag }, body });
    if (result.status !== 200) throw new ContextSyncError(`IMPORT_HTTP_${result.status}`);
    return { receipt: await confirm(result.data.receipt), reused: result.data.reused === true, recovered: false };
  } catch (error) {
    const recovered = await jsonRequest(receiptUrl, token, fetcher);
    if (recovered.status === 200) return { receipt: await confirm(recovered.data), reused: true, recovered: true };
    if (error instanceof ContextSyncError) throw error;
    throw new ContextSyncError('IMPORT_UNCONFIRMED');
  }
}

async function main() {
  const { values } = parseArgs({ options: { 'confirm-production': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    console.log('pnpm context:erp:publish [--confirm-production]\nGera e importa o contexto completo no laboratório. Exige ERP_CONTEXT_LAB_TOKEN. A confirmação consulta a versão servida; execução funcional permanece não observada.');
    return;
  }
  const endpoint = process.env.ERP_CONTEXT_LAB_URL || defaultEndpoint;
  const token = process.env.ERP_CONTEXT_LAB_TOKEN;
  configuration(endpoint, token);
  const context = await createContext();
  const destination = path.join(root, 'artifacts/product-context', context.contentSha256);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await writeImmutable(path.join(destination, 'context.json'), stableJson(context));
  const result = await publishContext(context, { endpoint, token, confirmPublication: values['confirm-production'] || false });
  await writeImmutable(path.join(destination, `receipt-${result.receipt.requestId}.json`), stableJson(result.receipt));
  console.log(JSON.stringify({ imported: true, ...result, output: path.relative(root, destination).split(path.sep).join('/') }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof ContextSyncError ? error.message : 'Não foi possível preparar ou confirmar o contexto; os artefatos anteriores foram preservados'); process.exitCode = 1; });
}
