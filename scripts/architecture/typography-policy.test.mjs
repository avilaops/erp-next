import test from "node:test";
import assert from "node:assert/strict";
import { validateTypography } from "./typography-policy.mjs";

const source = (name, content) => new Map([[`apps/web/src/${name}`, content]]);
test("a escala interna recusa exceções CSS e tamanhos avulsos", () => {
  assert.equal(validateTypography(source("app/custom.css", ".page { font-size: 24px; }")).length, 1);
  assert.equal(validateTypography(source("features/example.tsx", '<p className="text-[16px]">Texto</p>')).length, 1);
  assert.equal(validateTypography(source("features/example.tsx", '<p className="text-5xl">Texto</p>')).length, 1);
  assert.equal(validateTypography(source("server/consent.ts", "body{font:17px/1.5 system-ui}" )).length, 1);
});
test("a escala aceita os tokens, tamanhos aprovados e dados de impressão", () => {
  assert.deepEqual(validateTypography(source("app/custom.css", ".heading { font-size: var(--workspace-font-title); } .text { font-size: 14px; }")), []);
  assert.deepEqual(validateTypography(source("features/templates.tsx", "const field = { fontSize: 24 };")), []);
});
test("a apresentação pública permanece independente da escala interna", () => {
  assert.deepEqual(validateTypography(source("app/entrar/entrar.css", ".hero { font-size: 48px; }")), []);
});
