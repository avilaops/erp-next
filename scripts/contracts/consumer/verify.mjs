import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readOpenApi } from '../gate.mjs';

const directory = new URL('../../../artifacts/contracts/', import.meta.url);
const {document} = await readOpenApi(new URL('candidate.json', directory));
const fixture = JSON.parse(await readFile(new URL('company.json', directory),'utf8'));
assert.equal(fixture.synthetic,true);
const ajv = new Ajv({strict:false,allErrors:true});
addFormats(ajv);
const operation = document.paths['/api/v1/company'];
const schema = value => ({...value,components:document.components});
const request = ajv.compile(schema(operation.put.requestBody.content['application/json'].schema));
const response = ajv.compile(schema(operation.get.responses['200'].content['application/json'].schema));
assert.equal(request(fixture.request),true,JSON.stringify(request.errors));
assert.equal(response(fixture.saved),true,JSON.stringify(response.errors));
assert.equal(response(fixture.read),true,JSON.stringify(response.errors));
const missing = structuredClone(fixture.saved); delete missing.revision;
assert.equal(response(missing),false,'Missing revision must be refused by the independent consumer');
const wrong = structuredClone(fixture.saved); wrong.canEdit='true';
assert.equal(response(wrong),false,'Wrong response type must be refused');
const input = structuredClone(fixture.request); input.legalName=42;
assert.equal(request(input),false,'Wrong request type must be refused');
await copyFile(new URL('generated.d.ts',import.meta.url),new URL('consumer.d.ts',directory));
await writeFile(new URL('consumer.json',directory),JSON.stringify({schemaVersion:'erp-company-consumer/1',synthetic:true,
  operation:'/api/v1/company',validExamples:3,rejectedMutations:3,
  sources:['apps/api/src/platform/company.rs','apps/api/src/platform/company_data.rs','apps/api/src/http/company_tests.rs'],
  limitations:['Checks declared schemas and one synthetic PostgreSQL/router test; not deployed browser, Auth production or domain completeness.']},null,2));
