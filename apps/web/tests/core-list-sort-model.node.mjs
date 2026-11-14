import assert from "node:assert/strict"
import { test } from "node:test"
import { parseCatalogQuery, catalogQueryString } from "../src/features/catalog/catalog-query.ts"
import { parseRegistryQuery, registryQueryString } from "../src/features/records/registry-query.ts"

test("catalog explicit sort survives search, reset, pagination and detail return", () => {
 const query = parseCatalogQuery(new URLSearchParams("q=Banco&offset=50&sortBy=price&sortOrder=desc"))
 assert.equal(query.sortBy,"price"); assert.equal(query.sortOrder,"desc")
 for (const change of [{q:"Mesa",offset:0},{q:"",status:"",offset:0},{offset:75}]) {
  const result = parseCatalogQuery(new URLSearchParams(catalogQueryString({...query,...change})))
  assert.equal(result.sortBy,"price"); assert.equal(result.sortOrder,"desc")
 }
 assert.equal(parseCatalogQuery(new URLSearchParams("sortBy=sku")).sortOrder,"asc")
 for (const value of ["sortBy=bad&sortOrder=asc","sortBy=name&sortOrder=bad","sortOrder=desc"]) assert.equal(parseCatalogQuery(new URLSearchParams(value)).sortBy,undefined)
})

test("registry explicit sort roundtrips each endpoint's fields without changing legacy queries", () => {
 for (const [kind, field] of [["party","legalName"],["staff","jobTitle"],["reference","code"]]) {
  const query = parseRegistryQuery(new URLSearchParams({q:"Árvore",offset:"50",sortBy:field,sortOrder:"desc"}),kind)
  assert.equal(query.sortBy,field); assert.equal(query.sortOrder,"desc")
  for (const change of [{q:"Outra",offset:0},{q:"",role:"",status:"",offset:0},{offset:75}]) {
   const result = parseRegistryQuery(new URLSearchParams(registryQueryString({...query,...change})),kind)
   assert.equal(result.sortBy,field); assert.equal(result.sortOrder,"desc")
  }
  assert.equal(parseRegistryQuery(new URLSearchParams({sortBy:field}),kind).sortOrder,"asc")
 }
 for (const [kind,field] of [["party","name"],["staff","legalName"],["reference","price"],["reference","location"]]) assert.equal(parseRegistryQuery(new URLSearchParams({sortBy:field,sortOrder:"asc"}),kind).sortBy,undefined)
 assert.equal(parseRegistryQuery(new URLSearchParams("sortBy=location&sortOrder=desc"),"reference",["code","name","status","location"]).sortBy,"location")
 assert.equal(parseRegistryQuery(new URLSearchParams("sortBy=name&sortOrder=invalid"),"staff").sortBy,undefined)
})
