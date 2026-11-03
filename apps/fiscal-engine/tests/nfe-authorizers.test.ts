import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { configuredNfeServiceUrl, publishedNfeService, readNfeAuthorizerMatrix } from "../src/lib/fiscal/nfe-authorizers.ts";

const states = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const environments = ["homologacao", "producao"] as const;
const services = ["autorizacao", "retornoAutorizacao", "consulta", "eventos", "inutilizacao", "status", "cadastro"] as const;

test("official NF-e matrix has 27 issuer UFs per environment with pinned sources and explicit services", () => {
  const matrix = readNfeAuthorizerMatrix();
  for (const environment of environments) {
    assert.deepEqual(Object.keys(matrix.environments[environment].routing).sort(), states.toSorted());
    assert.match(matrix.environments[environment].sourceSha256, /^[a-f0-9]{64}$/);
    for (const uf of states) for (const service of services) {
      const entry = publishedNfeService(uf, environment, service);
      if (!entry) { assert.equal(service, "cadastro"); continue; }
      assert.equal(entry.issuerUf, uf);
      assert.equal(entry.environment, environment);
      assert.equal(entry.serviceVersion, "4.00");
      const url = new URL(entry.url);
      assert.equal(url.protocol, "https:");
      assert.equal(url.username + url.password + url.hash, "");
      assert.ok(["", "?wsdl"].includes(url.search));
    }
  }
});

test("issuer UF selects its own, SVAN or SVRS authority and cadastro never borrows an undeclared provider", () => {
  for (const environment of environments) {
    assert.equal(publishedNfeService("SP", environment, "autorizacao")?.authorizer, "SP");
    assert.equal(publishedNfeService("MA", environment, "autorizacao")?.authorizer, "SVAN");
    assert.equal(publishedNfeService("CE", environment, "autorizacao")?.authorizer, "SVRS");
    assert.equal(publishedNfeService("RS", environment, "autorizacao")?.authorizer, "RS");
    assert.equal(publishedNfeService("AC", environment, "cadastro")?.authorizer, "SVRS");
    assert.equal(publishedNfeService("AL", environment, "cadastro"), null);
    const go = publishedNfeService("GO", environment, "consulta")!;
    assert.equal(go.addressKind, "wsdl");
    assert.ok(go.url.endsWith("?wsdl"));
  }
});

test("contingency remains explicit and retains the published PI discrepancy between environments", () => {
  assert.equal(publishedNfeService("PI", "producao", "autorizacao", "contingencia")?.authorizer, "SVC-AN");
  assert.equal(publishedNfeService("PI", "homologacao", "autorizacao", "contingencia")?.authorizer, "SVC-RS");
  assert.equal(publishedNfeService("SP", "homologacao", "autorizacao")?.authorizer, "SP");
  assert.equal(publishedNfeService("PR", "homologacao", "inutilizacao", "contingencia"), null);
  assert.throws(() => configuredNfeServiceUrl("SP", "homologacao", "autorizacao", "contingencia"), /contingência.*não implementado/);
});

test("catalogued states cannot enable transport and configured SP URLs stay identical", () => {
  for (const environment of environments) {
    for (const uf of states.filter(uf => uf !== "SP")) for (const service of ["autorizacao", "consulta", "eventos", "inutilizacao"] as const) {
      assert.throws(() => configuredNfeServiceUrl(uf, environment, service), /não habilitada/);
    }
    const origin = environment === "homologacao" ? "https://homologacao.nfe.fazenda.sp.gov.br" : "https://nfe.fazenda.sp.gov.br";
    for (const [service, name] of [["autorizacao", "nfeautorizacao4"], ["consulta", "nfeconsultaprotocolo4"], ["eventos", "nferecepcaoevento4"], ["inutilizacao", "nfeinutilizacao4"]] as const) {
      assert.equal(configuredNfeServiceUrl("SP", environment, service), `${origin}/ws/${name}.asmx`);
    }
    assert.throws(() => configuredNfeServiceUrl("SP", environment, "status"), /implementado/);
  }
});

test("matrix corruption and invalid routing values fail without selecting a default or leaking reader errors", () => {
  const raw = readFileSync(new URL("../src/lib/fiscal/schemas/nfe-authorizers/matrix.json", import.meta.url), "utf8");
  assert.throws(() => readNfeAuthorizerMatrix(() => `${raw} `), /Matriz.*indisponível/);
  assert.throws(() => readNfeAuthorizerMatrix(() => { throw new Error("synthetic-private-reader"); }), error => error instanceof Error && !error.message.includes("synthetic-private-reader"));
  for (const uf of ["", "sp", "XX", "https://example.test", "__proto__"]) assert.throws(() => publishedNfeService(uf, "homologacao", "autorizacao"));
  assert.throws(() => publishedNfeService("SP", "production" as never, "autorizacao"));
  assert.throws(() => publishedNfeService("SP", "homologacao", "other" as never));
  assert.throws(() => publishedNfeService("SP", "homologacao", "autorizacao", "automatic" as never));
  assert.throws(() => publishedNfeService(["SP"] as never, "homologacao", "autorizacao"));
  assert.throws(() => publishedNfeService("SP", ["homologacao"] as never, "autorizacao"));
  assert.throws(() => publishedNfeService("SP", "homologacao", ["autorizacao"] as never));
});
