import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCatalogQuery, catalogQueryString } from "../src/features/catalog/catalog-query.ts";

test("category filters survive search and pagination URL round trips", () => {
  const category = "11111111-1111-4111-8111-111111111111";
  const parsed = parseCatalogQuery(new URLSearchParams({ q: " Core ", category_id: category, offset: "50", status: "active" }));
  assert.deepEqual(parsed, { q: "Core", status: "active", offset: 50, categoryId: category });
  assert.deepEqual(parseCatalogQuery(new URLSearchParams(catalogQueryString(parsed))), parsed);
});

test("invalid or absent category filters preserve the legacy query shape", () => {
  for (const category of ["", "core", "../other", "11111111-1111-4111-8111-111111111111-extra"]) {
    assert.deepEqual(parseCatalogQuery(new URLSearchParams({ category_id: category })), { q: "", status: "", offset: 0 });
  }
});
