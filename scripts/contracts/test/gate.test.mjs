import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import baselineRepair from '../baseline-1196d52.json' with { type: 'json' };

const adapter = await import('../gate.mjs').catch(() => null);
function document() {
  return { openapi: '3.1.0', info: {title:'Contract fixture',version:'1.0.0'},
    paths: {'/company': {post: {security: [], requestBody: {required:true, content: {'application/json': {schema: {
      type:'object',properties:{name:{type:'string'},kind:{type:'string',enum:['a','b']}},required:['name']
    }}}}, responses: {'200': {description:'ok',content:{'application/json':{schema:{type:'object',properties:{id:{type:'string'}},required:['id']}}}}}}}},
    components:{securitySchemes:{bearer:{type:'http',scheme:'bearer'}}}};
}
async function compare(mutate, options = {}) {
  assert.ok(adapter, 'OpenAPI gate is not implemented');
  const directory = await mkdtemp(path.join(os.tmpdir(),'erp-contract-'));
  try {
    const baseline=document(),candidate=structuredClone(baseline);mutate(candidate);
    await writeFile(path.join(directory,'base.json'),JSON.stringify(baseline));
    await writeFile(path.join(directory,'candidate.json'),JSON.stringify(candidate));
    const {before, ...settings}=options;
    if (before) await before(directory);
    return await adapter.compareContracts({baseline:path.join(directory,'base.json'),candidate:path.join(directory,'candidate.json'),output:directory,...settings});
  } finally { await rm(directory,{recursive:true,force:true}); }
}
test('identical contract is compatible', async()=> assert.equal((await compare(()=>{})).compatible,true));
test('optional request property addition is compatible', async()=>assert.equal((await compare(d=>{d.paths['/company'].post.requestBody.content['application/json'].schema.properties.extra={type:'string'};})).compatible,true));
test('removed endpoint is incompatible', async()=>assert.equal((await compare(d=>{d.paths={};})).compatible,false));
test('new required request property is incompatible', async()=>assert.equal((await compare(d=>{const s=d.paths['/company'].post.requestBody.content['application/json'].schema;s.properties.extra={type:'string'};s.required.push('extra');})).compatible,false));
test('narrowed request enum is incompatible', async()=>assert.equal((await compare(d=>{d.paths['/company'].post.requestBody.content['application/json'].schema.properties.kind.enum=['a'];})).compatible,false));
test('removed guaranteed response property is incompatible', async()=>assert.equal((await compare(d=>{const s=d.paths['/company'].post.responses['200'].content['application/json'].schema;s.required=[];delete s.properties.id;})).compatible,false));
test('removed success response is incompatible', async()=>assert.equal((await compare(d=>{d.paths['/company'].post.responses={'204':{description:'empty'}};})).compatible,false));
test('new authentication requirement is incompatible', async()=>assert.equal((await compare(d=>{d.paths['/company'].post.security=[{bearer:[]}];})).compatible,false));
test('invalid document fails closed', async()=>assert.rejects(compare(d=>{delete d.openapi;}),/INVALID_OPENAPI/));
test('parseable document with missing required info fails closed', async()=>assert.rejects(compare(d=>{d.info={};}),/INVALID_OPENAPI/));
test('external references are refused before invoking the comparator', async()=>assert.rejects(compare(d=>{d.components.schemas={Remote:{$ref:'https://example.invalid/schema.json'}};}),/INVALID_OPENAPI_EXTERNAL_REF/));
test('capture digests must match the exact compared documents',async()=>assert.rejects(compare(()=>{}, {before:async directory=>{
  await writeFile(path.join(directory,'capture.json'),JSON.stringify({schemaVersion:'erp-openapi-capture/1',initialContract:true,captures:[{label:'baseline',sha256:'0'.repeat(64)},{label:'candidate',sha256:'0'.repeat(64)}]}));
}}),/CAPTURE_HASH_MISMATCH/));
test('initial contract never claims event-base historical compatibility',async()=>{
  const report=await compare(()=>{}, {before:async directory=>{
    const captures=[];
    for(const [label,file] of [['baseline','base.json'],['candidate','candidate.json']]) captures.push({label,sha256:createHash('sha256').update(await readFile(path.join(directory,file))).digest('hex')});
    await writeFile(path.join(directory,'capture.json'),JSON.stringify({schemaVersion:'erp-openapi-capture/1',initialContract:true,captures}));
  }});
  assert.equal(report.compatible,true);
  assert.equal(report.comparisonScope,'initial_contract');
  assert.equal(report.eventBaseCompatibilityVerified,false);
});
test('comparator process failure fails closed', async()=>{
  assert.ok(adapter,'OpenAPI gate is not implemented');
  await assert.rejects(compare(()=>{}, {executable:'/nonexistent/oasdiff'}),/COMPARATOR_FAILED/);
});

async function repairedCapture(directory, override = {}) {
  const captures = [];
  for (const [label, file] of [['baseline', 'base.json'], ['candidate', 'candidate.json']]) captures.push({ label, sha256: createHash('sha256').update(await readFile(path.join(directory, file))).digest('hex') });
  await writeFile(path.join(directory, 'capture.json'), JSON.stringify({
    schemaVersion: 'erp-openapi-capture/1', initialContract: false,
    eventBaseRevision: baselineRepair.revision, baselineRevision: baselineRepair.revision,
    historicalCompatibilityVerified: false, baselineCompilationRepair: baselineRepair,
    baselineSources: [{ path: baselineRepair.path, sha256: baselineRepair.beforeSha256 }], captures,
    ...override,
  }));
}

test('instrumented historical capture never claims unmodified event-base runtime proof', async () => {
  const report = await compare(() => {}, { before: directory => repairedCapture(directory) });
  assert.equal(report.compatible, true);
  assert.equal(report.policyDecision.accepted, true);
  assert.equal(report.comparisonScope, 'instrumented_event_base');
  assert.equal(report.eventBaseCompatibilityVerified, false);
  assert.equal(report.runtimeVerified, false);
  assert.deepEqual(report.baselineCompilationRepair, baselineRepair);
});

test('altered revision, patch, source hash or historical claim rejects instrumentation', async () => {
  for (const override of [
    { baselineRevision: '0'.repeat(40) }, { eventBaseRevision: '0'.repeat(40) },
    { baselineCompilationRepair: { ...baselineRepair, replacement: 'pub permissions: Vec<String>' } },
    { baselineSources: [{ path: baselineRepair.path, sha256: '0'.repeat(64) }] },
    { historicalCompatibilityVerified: true }, { initialContract: true },
  ]) await assert.rejects(compare(() => {}, { before: directory => repairedCapture(directory, override) }), /INVALID_BASELINE_COMPILATION_REPAIR/);
});

test('baseline compilation instrumentation never admits a breaking API change', async () => {
  const report = await compare(document => { document.paths = {}; }, { before: directory => repairedCapture(directory) });
  assert.equal(report.compatible, false);
  assert.equal(report.policyDecision.accepted, false);
});

async function identicalInputsCapture(directory, mutate = () => {}) {
  const captures = [];
  for (const [label, file] of [['baseline', 'base.json'], ['candidate', 'candidate.json']]) captures.push({ label, sha256: createHash('sha256').update(await readFile(path.join(directory, file))).digest('hex') });
  const sources = ['Cargo.lock', 'Cargo.toml', 'apps/api/Cargo.toml', 'apps/api/src/http/openapi.rs',
    'apps/api/src/http/openapi_export.rs', 'rust-toolchain.toml'].map(name => ({ path: name, sha256: 'a'.repeat(64) }));
  const capture = {
    schemaVersion: 'erp-openapi-capture/1', captureMode: 'identical_api_inputs',
    initialContract: false, baselineInstrumented: false, historicalCompatibilityVerified: false,
    eventBaseRevision: '1'.repeat(40), baselineRevision: '1'.repeat(40), candidateRevision: '2'.repeat(40),
    helperSha256: 'a'.repeat(64), baselineSources: structuredClone(sources),
    eventBaseSources: structuredClone(sources), candidateSources: structuredClone(sources), captures,
    baselineReuseProof: { schemaVersion: 'erp-identical-api-inputs/1',
      inputPaths: ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'rust-toolchain', '.cargo', '.sqlx', 'apps/api', 'migrations', 'queries', 'deploy'],
      sourceCount: sources.length,
      sourcesSha256: createHash('sha256').update(sources.map(row => `${row.sha256}  ${row.path}\n`).join('')).digest('hex'),
      candidateSha256: captures[1].sha256, inputAudit: 'static-rust-inputs/1' },
  };
  mutate(capture);
  await writeFile(path.join(directory, 'capture.json'), JSON.stringify(capture));
}

test('identical API inputs retain compatibility checks and explicitly disclose baseline reuse', async () => {
  const report = await compare(() => {}, { before: directory => identicalInputsCapture(directory) });
  assert.equal(report.compatible, true);
  assert.equal(report.policyDecision.accepted, true);
  assert.equal(report.comparisonScope, 'identical_api_inputs');
  assert.equal(report.eventBaseCompatibilityVerified, false);
  assert.equal(report.runtimeVerified, false);
  assert.equal(report.baselineReuseProof.inputAudit, 'static-rust-inputs/1');
  assert.ok(report.limitations.some(message => message.includes('not separately executed')));
  await assert.rejects(compare(() => {}, { before: directory => identicalInputsCapture(directory), executable: '/nonexistent/oasdiff' }), /COMPARATOR_FAILED/);
});

test('baseline reuse refuses altered, deleted, empty or malformed input evidence', async () => {
  for (const mutate of [
    capture => { capture.baselineSources[0].sha256 = 'b'.repeat(64); },
    capture => { capture.eventBaseSources.pop(); },
    capture => { capture.candidateSources = []; },
    capture => { capture.candidateSources.push(capture.candidateSources[0]); },
    capture => { capture.baselineReuseProof.sourcesSha256 = '0'.repeat(64); },
    capture => { capture.baselineReuseProof.candidateSha256 = '0'.repeat(64); },
    capture => { capture.baselineReuseProof.inputPaths = ['apps/api']; },
    capture => { capture.baselineReuseProof.sourceCount += 1; },
    capture => { capture.baselineReuseProof.inputAudit = 'unverified'; },
    capture => { delete capture.baselineReuseProof; },
    capture => { capture.baselineRevision = '3'.repeat(40); },
    capture => { capture.initialContract = true; },
    capture => { capture.baselineInstrumented = true; },
    capture => { capture.baselineCompilationRepair = baselineRepair; },
    capture => { capture.historicalCompatibilityVerified = true; },
    capture => { capture.captureMode = 'historical_rust_test'; },
  ]) await assert.rejects(compare(() => {}, { before: directory => identicalInputsCapture(directory, mutate) }), /INVALID_IDENTICAL_API_INPUTS_PROOF/);
});

test('a reused baseline must contain exactly the candidate bytes', async () => {
  await assert.rejects(compare(document => { document.paths = {}; }, { before: directory => identicalInputsCapture(directory) }), /INVALID_IDENTICAL_API_INPUTS_PROOF/);
});
