import assert from "node:assert/strict";
import { test } from "node:test";
import * as model from "../src/features/sales/opportunity-pipeline-model.ts";
import { listNavigationHref } from "../src/lib/list-navigation.ts";

test("filtros do funil normalizam URL, Unicode, etapa e paginação sem enviar valores inválidos", () => {
  assert.equal(typeof model.readPipelineQuery, "function");
  assert.deepEqual(model.readPipelineQuery(new URLSearchParams("q=+Academia+&stage=won&offset=25")), { q: "Academia", stage: "won", offset: 25 });
  assert.deepEqual(model.readPipelineQuery(new URLSearchParams("stage=__proto__&offset=100001")), { q: "", stage: "", offset: 0 });
  for (const offset of ["-25", "25.5", "NaN", "9999999999999999"]) assert.equal(model.readPipelineQuery(new URLSearchParams({ offset })).offset, 0);
  assert.equal(model.readPipelineQuery(new URLSearchParams("offset=49")).offset, 25);
  const long = model.readPipelineQuery(new URLSearchParams({ q: "🏋️".repeat(160), stage: "negotiation" }));
  assert.equal(Array.from(long.q).length, 160);
  assert.equal(model.readPipelineQuery(new URLSearchParams({ q: "Academia\u0000Centro" })).q, "Academia Centro");
});

test("link do funil mantém filtros aplicados e usa apenas sua rota interna", () => {
  assert.equal(typeof model.pipelineHref, "function");
  const href = model.pipelineHref({ q: "A & B", stage: "lost", offset: 50 });
  const url = new URL(href, "https://erp.local");
  assert.equal(url.pathname, "/vendas/funil");
  assert.equal(url.searchParams.get("q"), "A & B");
  assert.equal(url.searchParams.get("stage"), "lost");
  assert.equal(url.searchParams.get("offset"), "50");
  assert.deepEqual(model.readPipelineQuery(url.searchParams), { q: "A & B", stage: "lost", offset: 50 });
});

test("resumo distingue falta de dados de zero e soma só valores inteiros seguros da empresa", () => {
  assert.equal(typeof model.pipelineSummary, "function");
  assert.equal(model.pipelineSummary(undefined), null);
  assert.deepEqual(model.pipelineSummary([]), { open: { count: 0, estimatedCents: 0 }, won: { count: 0, estimatedCents: 0 }, lost: { count: 0, estimatedCents: 0 } });
  assert.deepEqual(model.pipelineSummary([
    { stage: "new", count: 20, estimatedCents: 10001 }, { stage: "negotiation", count: 3, estimatedCents: 20002 },
    { stage: "won", count: 4, estimatedCents: 30003 }, { stage: "lost", count: 2, estimatedCents: 40004 },
  ]), { open: { count: 23, estimatedCents: 30003 }, won: { count: 4, estimatedCents: 30003 }, lost: { count: 2, estimatedCents: 40004 } });
  for (const rows of [
    [{ stage: "new", count: -1, estimatedCents: 10 }], [{ stage: "new", count: 1, estimatedCents: 1.5 }],
    [{ stage: "new", count: 1, estimatedCents: Number.MAX_SAFE_INTEGER }, { stage: "proposed", count: 1, estimatedCents: 1 }],
    [{ stage: "new", count: 1, estimatedCents: 1 }, { stage: "new", count: 1, estimatedCents: 1 }],
  ]) assert.equal(model.pipelineSummary(rows), null);
});

test("consulta e criação de oportunidade conservam retorno do funil e recusam destino externo", () => {
  const list = "/vendas/funil";
  const query = "q=Academia&stage=won&offset=25";
  const detail = listNavigationHref(list + "/novo-id", list, query);
  const params = new URL(detail, "https://erp.local").searchParams;
  assert.equal(params.get("returnTo"), list + "?" + query);
  assert.equal(listNavigationHref(list, list + "/novo-id", params.toString()), list + "?" + query);
  assert.equal(listNavigationHref(list, list + "/novo-id", "returnTo=https%3A%2F%2Fexterno.example"), list);
  assert.equal(listNavigationHref("/preferencias", list, query), "/preferencias");
});

test("valores do resumo conservam centavos até o limite inteiro seguro", () => {
  assert.equal(typeof model.pipelineMoney, "function");
  assert.equal(model.pipelineMoney(Number.MAX_SAFE_INTEGER), "R$\u00a090.071.992.547.409,91");
  assert.equal(model.pipelineMoney(30003), "R$\u00a0300,03");
  assert.equal(model.pipelineMoney(-1), "Valor indisponível");
  assert.equal(model.pipelineMoney(Number.MAX_SAFE_INTEGER + 1), "Valor indisponível");
});
