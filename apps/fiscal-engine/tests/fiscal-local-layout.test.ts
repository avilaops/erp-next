import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { assertFiscalXml, createFiscalXmlValidator, FiscalXmlError, readFiscalSchemas } from "@/lib/fiscal/local-layout";
import manifest from "../src/lib/fiscal/schemas/manifest.json" with { type: "json" };
import { buildNfeXml } from "@/lib/fiscal/nfe";
import { eventXml } from "@/lib/fiscal/events";
import { voidXml } from "@/lib/fiscal/sefaz";
import { signNfeXml, signEventXml, signVoidXml, signingKeyOf } from "@/lib/fiscal/sign";
import { layoutInvoice } from "./fiscal-layout-fixture.ts";
import { testPfx } from "./fiscal-helpers.ts";

const key = signingKeyOf(testPfx(), "senha-de-teste");
const built = buildNfeXml(layoutInvoice());
const signed = signNfeXml(built.xml, key);
const valid = { valid: true, errors: [], normalized: "", rawOutput: "" };
const reason = (wanted: "invalid" | "unavailable") => (error: unknown) => error instanceof FiscalXmlError && error.reason === wanted;

test("schemas locais: versões, hashes e arquivos coincidem com as fontes versionadas", async () => {
  for (const kind of ["nfe", "evento", "inutilizacao"] as const) {
    const bundle = await readFiscalSchemas(kind);
    assert.equal(bundle.release, manifest.packages[kind].release);
    for (const file of manifest.packages[kind].files) {
      const source = await readFile(new URL(`./fixtures/nfe-xsd/${file.fixture}`, import.meta.url), "utf8");
      assert.equal(bundle.files.find((item) => item.fileName === file.name)!.contents.trimEnd(), source.replace(/\r\n/g, "\n").trimEnd());
    }
  }
});

test("conferência local: NF-e assinada válida passa; versão, conteúdo e sintaxe inválidos bloqueiam", async () => {
  await assertFiscalXml(signed, "nfe");
  for (const invalid of [signed.replace('versao="4.00"', 'versao="3.10"'), signed.replace("<NCM>95069100", "<NCM>0"), signed.replace("</NFe>", "</Incorreto>")]) {
    await assert.rejects(() => assertFiscalXml(invalid, "nfe"), reason("invalid"));
  }
  await assert.rejects(() => assertFiscalXml(built.xml, "nfe"), /documento assinado/);
});

test("conferência local: eventos e inutilização assinados, inclusive CNPJ alfanumérico", async () => {
  for (const cnpj of ["12345678000195", "12ABC34501DE35"]) {
    const invoice = buildNfeXml({ ...layoutInvoice(), issuer: { ...layoutInvoice().issuer, cnpj } });
    for (const kind of ["cancelamento", "correcao"] as const) {
      const event = eventXml({ kind, environment: "homologacao", accessKey: invoice.key, cnpj, at: "2026-10-17T10:00:00-03:00", sequence: 1, protocol: "135260000012345", text: "Justificativa fictícia para validação de leiaute." });
      await assertFiscalXml(signEventXml(event.xml, key), "evento");
    }
    const voided = voidXml({ environment: "homologacao", stateCode: "35", year: "26", cnpj, series: 1, first: 44, last: 46, reason: "Faixa fictícia para validação local." });
    await assertFiscalXml(signVoidXml(voided.xml, key), "inutilizacao");
  }
});

test("conferência local: DTD, entidades, tamanho e assinatura são recusados antes de executar o motor", async () => {
  let calls = 0;
  const check = createFiscalXmlValidator(readFiscalSchemas, async () => { calls += 1; return valid; });
  for (const xml of [signed + "\0", `<!DOCTYPE NFe SYSTEM "https://exemplo.test/externo.dtd">${signed}`, `<!ENTITY segredo SYSTEM "file:///etc/passwd">${signed}`, "x".repeat(1_048_577), "<NFe/>"]) {
    await assert.rejects(() => check(xml, "nfe"), reason("invalid"));
  }
  assert.equal(calls, 0);
});

test("conferência local: arquivo ausente ou alterado bloqueia sem expor caminho/segredo; falha pode ser repetida", async () => {
  const read = (relative: string) => readFile(new URL(`../src/lib/fiscal/schemas/${relative}`, import.meta.url), "utf8");
  await assert.rejects(() => readFiscalSchemas("nfe", async () => { throw new Error("caminho-privado/segredo"); }), (error: unknown) => reason("unavailable")(error) && !String(error).includes("segredo"));
  await assert.rejects(() => readFiscalSchemas("nfe", async (name) => (await read(name)) + "<!-- alteração -->"), reason("unavailable"));
  let loads = 0;
  const check = createFiscalXmlValidator(async (kind) => { if (loads++ === 0) throw new Error("falha temporária"); return readFiscalSchemas(kind); }, async () => valid);
  await assert.rejects(() => check(signed, "nfe"), reason("unavailable"));
  await check(signed, "nfe");
  await check(signed, "nfe");
  assert.equal(loads, 2);
});

test("conferência local: falha do motor não libera o XML, usa somente arquivos locais e memória limitada", async () => {
  const broken = createFiscalXmlValidator(readFiscalSchemas, async () => { throw new Error("WASM ausente"); });
  await assert.rejects(() => broken(signed, "nfe"), reason("unavailable"));
  const check = createFiscalXmlValidator(readFiscalSchemas, async (options) => {
    assert.equal(options.maxMemoryPages, 1024);
    assert.ok(options.modifyArguments!(["--schema", "nfe_v4.00.xsd"]).includes("--nonet"));
    assert.ok(Array.isArray(options.preload) && options.preload.length > 0);
    return valid;
  });
  await check(signed, "nfe");
});

test("conferência local: concorrência limita trabalhadores e libera capacidade após terminar", { timeout: 10_000 }, async () => {
  const releases: Array<() => void> = [];
  const check = createFiscalXmlValidator(readFiscalSchemas, () => new Promise((resolve) => releases.push(() => resolve(valid))));
  const calls = Array.from({ length: 4 }, () => check(signed, "nfe"));
  await assert.rejects(() => check(signed, "nfe"), /ocupada/);
  while (releases.length < 4) await new Promise((resolve) => setImmediate(resolve));
  releases.splice(0).forEach((release) => release());
  await Promise.all(calls);
  const next = check(signed, "nfe");
  while (releases.length < 1) await new Promise((resolve) => setImmediate(resolve));
  releases.shift()!();
  await next;
});
