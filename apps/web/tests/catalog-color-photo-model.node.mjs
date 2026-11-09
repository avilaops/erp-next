import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { catalogColorPhoto, catalogPaletteFor } from "../src/features/catalog/catalog-color-photo-model.ts";

test("legacy Portuguese aliases require the complete same-product DHZ signature", () => {
  assert.equal(catalogPaletteFor(["Piano Black", "Titanium Grey", "Graphite Black"]), "dhz-hammerforce");
  assert.equal(catalogPaletteFor(["PianoBlack", "TitaniumGrey", "MatteGraphiteBlack"]), "dhz-hammerforce");
  for (const colors of [undefined, [], ["Preto", "Cinza"], ["Piano Black"], ["Piano Black", "Titanium Grey"]]) {
    assert.equal(catalogPaletteFor(colors), undefined);
  }
  const aliases = { Preto: "Piano Black", Grafite: "Matte Graphite Black", Cinza: "Light Grey", Vermelho: "Performance Red", Laranja: "Hermès Orange", Azul: "Ocean Blue" };
  for (const [stored, name] of Object.entries(aliases)) {
    assert.equal(catalogColorPhoto(stored), undefined);
    assert.equal(catalogColorPhoto(stored, "dhz-hammerforce")?.name, name);
  }
  assert.equal(catalogColorPhoto("Amarelo", "dhz-hammerforce"), undefined);
  assert.equal(catalogColorPhoto("Black"), undefined);
});

test("matches distinctive catalog names while preserving the selected stored name", () => {
  assert.equal(catalogColorPhoto("Piano Black")?.name, "Piano Black");
  assert.equal(catalogColorPhoto("Graphite Black")?.name, "Matte Graphite Black");
  assert.equal(catalogColorPhoto("Hermès Orange")?.name, "Hermès Orange");
  assert.equal(catalogColorPhoto("Ocean Blue")?.name, "Ocean Blue");
  assert.equal(catalogColorPhoto("Titanium Grey")?.name, "Titanium Grey");
});

test("does not assign DHZ photos to generic or unknown colors", () => {
  for (const color of ["Black", "Preto", "Red", "Cinza", "Azul", "Piano Black especial", ""]) {
    assert.equal(catalogColorPhoto(color), undefined);
  }
});

test("catalog asset keeps the original embedded image bytes recorded in provenance", () => {
  const provenance = JSON.parse(readFileSync(new URL("../public/catalog/dhz-hammerforce-pro-original-colors.provenance.json", import.meta.url), "utf8"));
  const image = readFileSync(new URL(`../public/catalog/${provenance.asset}`, import.meta.url));
  assert.equal(image.length, provenance.assetBytes);
  assert.equal(createHash("sha256").update(image).digest("hex"), provenance.assetSha256);
  for (const name of ["Piano Black", "Graphite Black", "Light Grey", "Performance Red", "Titanium Grey", "Hermès Orange", "Apple Green", "Ocean Blue", "Saddle Brown", "Reddish Brown", "Mocha"]) {
    const rectangle = catalogColorPhoto(name);
    assert.ok(rectangle, name);
    assert.ok(rectangle.x + rectangle.width <= provenance.width, name);
    assert.ok(rectangle.y + rectangle.height <= provenance.height, name);
  }
});
