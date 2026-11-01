import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateWeb } from "../generate-web.mjs";

test("web types follow the supplied contract and reproduce identical bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "erp-web-contract-"));
  try {
    const input = path.join(directory, "contract.json");
    const output = path.join(directory, "types.d.ts");
    await writeFile(input, JSON.stringify({
      openapi: "3.1.0", info: {title:"Fixture",version:"1"},
      paths: {"/api/v1/company":{get:{operationId:"company",responses:{"200":{
        description:"Company",content:{"application/json":{schema:{$ref:"#/components/schemas/Company"}}}
      }}}}},
      components:{schemas:{Company:{type:"object",required:["revision"],properties:{revision:{type:"integer"}}}}}
    }));
    const first = await generateWeb(input, output);
    assert.match(first, /revision: number/);
    assert.equal(await readFile(output,"utf8"), first);
    assert.equal(await generateWeb(input,output), first);
    const document = JSON.parse(await readFile(input,"utf8"));
    document.components.schemas.Company.properties.revision.type = "string";
    await writeFile(input, JSON.stringify(document));
    assert.match(await generateWeb(input,output), /revision: string/);
    document.components.schemas.Company = {$ref:"https://example.invalid/schema.json"};
    await writeFile(input, JSON.stringify(document));
    await assert.rejects(generateWeb(input,output));
    await assert.rejects(generateWeb(path.join(directory,"missing.json"),output));
  } finally { await rm(directory, {recursive:true,force:true}); }
});
