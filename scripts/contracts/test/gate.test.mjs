import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const adapter = await import('../gate.mjs').catch(() => null);
function document() {
  return { openapi: '3.1.0', info: {title:'Contract fixture',version:'1.0.0'},
    paths: {'/company': {post: {security: [], requestBody: {required:true, content: {'application/json': {schema: {
      type:'object',properties:{name:{type:'string'},kind:{type:'string',enum:['a','b']}},required:['name']
    }}}}, responses: {'200': {description:'ok',content:{'application/json':{schema:{type:'object',properties:{id:{type:'string'}},required:['id']}}}}}}}},
    components:{securitySchemes:{bearer:{type:'http',scheme:'bearer'}}}};
}
async function compare(mutate) {
  assert.ok(adapter, 'OpenAPI gate is not implemented');
  const directory = await mkdtemp(path.join(os.tmpdir(),'erp-contract-'));
  try {
    const baseline=document(),candidate=structuredClone(baseline);mutate(candidate);
    await writeFile(path.join(directory,'base.json'),JSON.stringify(baseline));
    await writeFile(path.join(directory,'candidate.json'),JSON.stringify(candidate));
    return await adapter.compareContracts({baseline:path.join(directory,'base.json'),candidate:path.join(directory,'candidate.json'),output:directory});
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
test('comparator process failure fails closed', async()=>{
  assert.ok(adapter,'OpenAPI gate is not implemented');
  await assert.rejects(adapter.compareContracts({baseline:'missing',candidate:'missing',output:os.tmpdir(),executable:'/nonexistent/oasdiff'}));
});
