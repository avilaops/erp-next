import assert from "node:assert/strict";
import { test } from "node:test";
import { cnpjRegistration } from "../src/features/records/cnpj-registration-model.ts";

test("registration status carries the source closure date and reason independently of the ERP status", () => {
  const status = cnpjRegistration({ registrationStatusCode: "8", registrationStatus: "BAIXADA", registrationStatusDate: "2026-04-15", registrationStatusReason: "Encerramento informado", status: "active" });
  assert.equal(status.label, "BAIXADA");
  assert.equal(status.requiresAttention, true);
  assert.equal(status.date, "15/04/2026");
  assert.equal(status.reason, "Encerramento informado");
});

test("only a consistent active status is presented as active", () => {
  assert.equal(cnpjRegistration({ registrationStatusCode: "2", registrationStatus: "ATIVA" }).requiresAttention, false);
  for (const [code, label] of [["1", "NULA"], ["3", "SUSPENSA"], ["4", "INAPTA"], ["8", "BAIXADA"]]) {
    assert.equal(cnpjRegistration({ registrationStatusCode: code, registrationStatus: label }).requiresAttention, true);
  }
  for (const fields of [{}, { registrationStatusCode: "unknown" }, { registrationStatusCode: "2", registrationStatus: "BAIXADA" }, { registrationStatusCode: "2", registrationStatus: "BAIXADA".repeat(30) }, { registrationStatusCode: "2", registrationStatus: {} }]) {
    assert.equal(cnpjRegistration(fields).known, false);
    assert.equal(cnpjRegistration(fields).label, "Não confirmada");
  }
});

test("invalid source dates and malformed fields are never formatted as real dates", () => {
  for (const date of ["2026-02-30", "invalid", "<html>", null, {}]) {
    assert.equal(cnpjRegistration({ registrationStatusCode: "8", registrationStatus: "BAIXADA", registrationStatusDate: date }).date, null);
  }
});
