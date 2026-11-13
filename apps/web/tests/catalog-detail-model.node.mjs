import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const palettes = ts.transpileModule(readFileSync(new URL("../src/features/catalog/catalog-finish-palettes.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const model = ts.transpileModule(readFileSync(new URL("../src/features/catalog/catalog-color-photo-model.ts", import.meta.url), "utf8").replace('"./catalog-finish-palettes.ts"', JSON.stringify(moduleUrl(palettes))), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const component = readFileSync(new URL("../src/features/catalog/catalog-color-photos.tsx", import.meta.url), "utf8")
  .replace('"./catalog-color-photo-model"', JSON.stringify(moduleUrl(model)))
  .replace('"./catalog-finish-palettes"', JSON.stringify(moduleUrl(palettes)));
const compiled = ts.transpileModule(`import React from ${JSON.stringify(pathToFileURL(require.resolve("react")).href)};\n${component}`, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const { CatalogColorPhotos } = await import(moduleUrl(compiled));

test("product detail presents original palette without disabled tint or editable buttons", () => {
  const html = renderToStaticMarkup(React.createElement(CatalogColorPhotos, { label: "Braços", part: "swingArm", options: ["Piano Black", "Hermès Orange", "Amarelo"], palette: "dhz-hammerforce-pro", readOnly: true }));
  assert.equal((html.match(/background-image/g) ?? []).length, 2);
  assert.match(html, /Amarelo/);
  assert.doesNotMatch(html, /<button|disabled|opacity-50|aria-pressed/);
  assert.match(html, /dhz-hammerforce-pro-original-colors.jpeg/);
});

test("read-only unknown finishes keep their labels without invented photos", () => {
  const html = renderToStaticMarkup(React.createElement(CatalogColorPhotos, { label: "Estrutura", part: "structure", options: ["Preto", "Amarelo"], readOnly: true }));
  assert.match(html, /Preto/);
  assert.match(html, /Amarelo/);
  assert.doesNotMatch(html, /background-image|catálogo DHZ ·/);
});

test("upholstery and signature choices keep their own catalog material and grouping", () => {
  const fabric = renderToStaticMarkup(React.createElement(CatalogColorPhotos, { label: "Estofado", part: "upholstery", options: ["Black", "Khaki", "Mocha"], palette: "dhz-sforce", readOnly: true }));
  assert.equal((fabric.match(/background-image/g) ?? []).length, 3);
  assert.match(fabric, /dhz-s-force-original-colors.jpeg/);
  assert.doesNotMatch(fabric, /dhz-hammerforce-pro-original-colors.jpeg/);
  const paint = renderToStaticMarkup(React.createElement(CatalogColorPhotos, { label: "Estrutura", part: "structure", options: ["Piano Black", "Titanium Grey"], palette: "dhz-hammerforce-pro", value: "Titanium Grey", onChange() {} }));
  assert.match(paint, /Padrão/);
  assert.match(paint, /Especiais do catálogo/);
  assert.equal((paint.match(/aria-pressed="true"/g) ?? []).length, 1);
});
