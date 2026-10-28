import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { readOpenApi } from '../gate.mjs';
import { checkExamples } from './validate.mjs';

const directory = new URL('../../../artifacts/contracts/', import.meta.url);
const {document} = await readOpenApi(new URL('candidate.json', directory));
const fixture = JSON.parse(await readFile(new URL('company.json', directory),'utf8'));
checkExamples(document,fixture);
await copyFile(new URL('generated.d.ts',import.meta.url),new URL('consumer.d.ts',directory));
await writeFile(new URL('consumer.json',directory),JSON.stringify({schemaVersion:'erp-company-consumer/1',synthetic:true,
  operation:'/api/v1/company',validExamples:3,rejectedMutations:3,
  sources:['apps/api/src/platform/company.rs','apps/api/src/platform/company_data.rs','apps/api/src/http/company_tests.rs'],
  limitations:['Checks declared schemas and one synthetic PostgreSQL/router test; not deployed browser, Auth production or domain completeness.']},null,2));
