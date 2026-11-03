import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { decodeNfseBytes, nfseMoney, parseNfseDetail, parseNfsePage } from "../src/features/fiscal/nfse-received-model.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const xml = await readFile(new URL("../../api/src/http/fixtures/nfse-national.xml", import.meta.url), "utf8");
const metadata = JSON.parse(await readFile(new URL("../../api/src/http/fixtures/nfse-national-inspection.json", import.meta.url), "utf8"));
delete metadata.xml;
const document = { id: "22222222-2222-4222-8222-222222222222", companyTaxId: "04252011000110", document: metadata, createdAt: "2026-11-03T10:00:00Z" };
const bytes = text => new TextEncoder().encode(text).buffer;

test("NFS-e upload preserves BOM and line endings and rejects empty, excessive and malformed UTF-8 files", async () => {
  for (const source of [xml, `\uFEFF${xml.replaceAll("\n", "\r\n")}`]) {
    const result = await decodeNfseBytes(bytes(source));
    assert.equal(result.xml, source);
    assert.equal(result.xmlSha256.length, 64);
  }
  for (const source of [new ArrayBuffer(0), new ArrayBuffer(1_048_577), Uint8Array.from([0xc3, 0x28]).buffer]) await assert.rejects(decodeNfseBytes(source));
});

test("NFS-e money keeps exact cents beyond Number precision", () => {
  assert.equal(nfseMoney("0"), "R$ 0,00");
  assert.equal(nfseMoney("12345"), "R$ 123,45");
  assert.equal(nfseMoney("90071992547409931"), "R$ 900.719.925.474.099,31");
});

test("NFS-e wire data must match tenant, source, profile and immutable recipient identity", () => {
  assert.equal(parseNfsePage({ tenantId: tenant, canImport: true, data: [document], total: 1 }, tenant).data.length, 1);
  assert.equal(parseNfseDetail({ tenantId: tenant, data: document }, tenant).id, document.id);
  for (const mutate of [
    value => { value.tenantId = document.id; },
    value => { value.data.document.source = "nfe"; },
    value => { value.data.document.recipient.value = "19131243000197"; },
    value => { value.data.document.environment = "unknown"; },
    value => { value.data.document.environment = ["production"]; },
    value => { value.data.document.issuer.kind = ["CNPJ"]; },
    value => { value.data.document.provider.kind = ["CPF"]; },
    value => { value.data.document.accessKey = "1".repeat(44); },
    value => { value.data.document.verification.layout = "official_schema_valid"; },
    value => { value.data.document.verification.signature = "verified"; },
    value => { value.data.document.serviceCents = 12345; },
  ]) {
    const value = structuredClone({ tenantId: tenant, data: document });
    mutate(value);
    assert.throws(() => parseNfseDetail(value, tenant));
  }
  assert.throws(() => parseNfsePage({ tenantId: tenant, canImport: true, data: [document, document], total: 2 }, tenant));
});
