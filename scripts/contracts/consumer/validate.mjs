import assert from 'node:assert/strict';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export function checkExamples(document, fixture) {
  assert.equal(fixture.synthetic,true);
  const ajv = new Ajv({strict:false,allErrors:true});
  addFormats(ajv);
  const operation = document.paths['/api/v1/company'];
  const schema = value => ({...value,components:document.components});
  const request = ajv.compile(schema(operation.put.requestBody.content['application/json'].schema));
  const response = ajv.compile(schema(operation.get.responses['200'].content['application/json'].schema));
  const savedResponse = ajv.compile(schema(operation.put.responses['200'].content['application/json'].schema));
  assert.equal(request(fixture.request),true,JSON.stringify(request.errors));
  assert.equal(savedResponse(fixture.saved),true,JSON.stringify(savedResponse.errors));
  assert.equal(response(fixture.read),true,JSON.stringify(response.errors));
  const missing = structuredClone(fixture.saved); delete missing.revision;
  assert.equal(savedResponse(missing),false,'Missing revision must be refused by the independent consumer');
  const wrong = structuredClone(fixture.saved); wrong.canEdit='true';
  assert.equal(savedResponse(wrong),false,'Wrong response type must be refused');
  const input = structuredClone(fixture.request); input.legalName=42;
  assert.equal(request(input),false,'Wrong request type must be refused');
}
