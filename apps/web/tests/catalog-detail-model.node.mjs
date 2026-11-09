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
const model = ts.transpileModule(readFileSync(new URL("../src/features/catalog/catalog-color-photo-model.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const component = readFileSync(new URL("../src/features/catalog/catalog-color-photos.tsx", import.meta.url), "utf8")
  .replace('"./catalog-color-photo-model"', JSON.stringify(moduleUrl(model)));
const compiled = ts.transpileModule(`import React from ${JSON.stringify(pathToFileURL(require.resolve("react")).href)};\n${component}`, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const { CatalogColorPhotos } = await import(moduleUrl(compiled));

test("product detail presents original palette without disabled tint or editable buttons", () => {
  const html = renderToStaticMarkup(React.createElement(CatalogColorPhotos, { label: "Braços", options: ["Preto", "Laranja", "Amarelo"], palette: "dhz-hammerforce", readOnly: true }));
  assert.equal((html.match(/background-image/g) ?? []).length, 2);
  assert.match(html, /Amarelo/);
  assert.doesNotMatch(html, /<button|disabled|opacity-50|aria-pressed/);
  assert.match(html, /dhz-hammerforce-pro-original-colors.jpeg/);
});

test("read-only unknown finishes keep their labels without invented photos", () => {
  const html = renderToStaticMarkup(React.createElement(CatalogColorPhotos, { label: "Estrutura", options: ["Preto", "Amarelo"], readOnly: true }));
  assert.match(html, /Preto/);
  assert.match(html, /Amarelo/);
  assert.doesNotMatch(html, /background-image|catálogo DHZ ·/);
});
