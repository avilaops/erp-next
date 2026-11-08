import test from "node:test"
import assert from "node:assert/strict"
import { fiscalApiOrigin } from "../src/server/bff/local-fiscal-api.ts"
test("fiscal development override is limited to loopback and fiscal preparation routes", () => {
  const original = "https://api.example.test"
  for (const route of ["/fiscal/nfe", "/fiscal/nfe/123/emission", "/fiscal/readiness", "/fiscal/certificate", "/fiscal/outgoing-imports", "/fiscal/outgoing-imports/17/xml"]) assert.equal(fiscalApiOrigin(route, original, "http://127.0.0.1:8081", "development"), "http://127.0.0.1:8081")
  for (const route of ["/products", "/fiscal/danfe", "/fiscal/incoming", "/fiscal/nfe-other"]) assert.equal(fiscalApiOrigin(route, original, "http://127.0.0.1:8081", "development"), original)
  assert.equal(fiscalApiOrigin("/fiscal/nfe", original, "http://127.0.0.1:8081", "production"), original)
  for (const invalid of ["https://external.example", "http://user:pass@127.0.0.1:8081", "http://127.0.0.1:8081/path", "http://127.0.0.1:8081/?token=secret"]) assert.throws(() => fiscalApiOrigin("/fiscal/nfe", original, invalid, "development"))
})
