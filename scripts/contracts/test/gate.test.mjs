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
