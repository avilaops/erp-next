import test from 'node:test';
import assert from 'node:assert/strict';
import { checkExamples } from '../consumer/validate.mjs';

function fixture() {
  const request={type:'object',properties:{legalName:{type:'string'}},required:['legalName']};
  const response={type:'object',properties:{revision:{type:'number'},canEdit:{type:'boolean'}},required:['revision','canEdit']};
  const content=schema=>({'application/json':{schema}});
  return {document:{components:{},paths:{'/api/v1/company':{
    get:{responses:{'200':{content:content(structuredClone(response))}}},
    put:{requestBody:{content:content(request)},responses:{'200':{content:content(structuredClone(response))}}}
  }}},examples:{synthetic:true,request:{legalName:'Synthetic'},saved:{revision:1,canEdit:true},read:{revision:1,canEdit:false}}};
}
test('consumer validates synthetic request and separate GET/PUT responses',()=>{const f=fixture();checkExamples(f.document,f.examples);});
test('consumer refuses a PUT guarantee absent from actual saved response',()=>{
  const f=fixture();const s=f.document.paths['/api/v1/company'].put.responses['200'].content['application/json'].schema;
  s.properties.receipt={type:'string'};s.required.push('receipt');
  assert.throws(()=>checkExamples(f.document,f.examples));
});
