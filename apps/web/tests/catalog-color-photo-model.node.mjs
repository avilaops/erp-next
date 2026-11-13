import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { catalogColorPhoto, catalogPaletteFor } from "../src/features/catalog/catalog-color-photo-model.ts";
import { getCatalogFinishPalette } from "../src/features/catalog/catalog-finish-palettes.ts";

test("a palette requires an explicit catalog reference rather than a set of common paint names", () => {
  assert.equal(catalogPaletteFor("dhz-hammerforce-pro"), "dhz-hammerforce-pro");
  assert.equal(catalogPaletteFor("dhz-sforce"), "dhz-sforce");
  for (const value of [undefined, null, "", "other", ["Piano Black", "Titanium Grey", "Graphite Black"]]) {
    assert.equal(catalogPaletteFor(value), undefined);
  }
});

test("generic translated colors never acquire an invented manufacturer texture", () => {
  for (const color of ["Preto", "Grafite", "Cinza", "Vermelho", "Laranja", "Amarelo", "Azul"]) {
    for (const reference of [undefined, "dhz-hammerforce-pro", "dhz-sforce"]) {
      assert.equal(catalogColorPhoto(color, reference, "swingArm"), undefined);
    }
  }
  assert.equal(catalogColorPhoto("Piano Black"), undefined);
});

test("paint, signature colors and upholstery resolve only for their declared component", () => {
  assert.equal(catalogColorPhoto("Graphite Black", "dhz-hammerforce-pro", "structure")?.name, "Matte Graphite Black");
  assert.equal(catalogColorPhoto("Hermès Orange", "dhz-hammerforce-pro", "structure"), undefined);
  assert.equal(catalogColorPhoto("Hermès Orange", "dhz-hammerforce-pro", "swingArm")?.name, "Hermès Orange");
  assert.equal(catalogColorPhoto("Ocean Blue", "dhz-hammerforce-pro", "swingArm")?.name, "Ocean Blue");
  assert.equal(catalogColorPhoto("Black", "dhz-hammerforce-pro", "upholstery")?.name, "Black");
  assert.equal(catalogColorPhoto("Black", "dhz-hammerforce-pro", "structure"), undefined);
  assert.equal(catalogColorPhoto("Piano Black", "dhz-hammerforce-pro", "upholstery"), undefined);
  assert.equal(catalogColorPhoto("Khaki", "dhz-hammerforce-pro", "upholstery"), undefined);
  assert.equal(catalogColorPhoto("Khaki", "dhz-sforce", "upholstery")?.name, "Khaki");
});

test("both catalogs use their own unchanged raster and every declared sample stays inside it", () => {
  for (const [reference, asset] of [["dhz-hammerforce-pro", "dhz-hammerforce-pro"], ["dhz-sforce", "dhz-s-force"]]) {
    const provenance = JSON.parse(readFileSync(new URL(`../public/catalog/${asset}-original-colors.provenance.json`, import.meta.url), "utf8"));
    const bytes = readFileSync(new URL(`../public/catalog/${provenance.asset}`, import.meta.url));
    assert.equal(bytes.length, provenance.assetBytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), provenance.assetSha256);
    const palette = getCatalogFinishPalette(reference);
    for (const part of ["structure", "swingArm", "upholstery"]) {
      for (const name of [...palette[part].standard, ...palette[part].special]) {
        const sample = catalogColorPhoto(name, reference, part);
        assert.ok(sample, `${reference}/${part}/${name}`);
        assert.equal(sample.asset, palette.source.asset);
        assert.ok(sample.x >= 0 && sample.y >= 0);
        assert.ok(sample.x + sample.width <= provenance.width);
        assert.ok(sample.y + sample.height <= provenance.height);
        assert.equal(sample.y >= 1653, part === "upholstery");
      }
    }
  }
});
