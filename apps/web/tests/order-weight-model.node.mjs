import assert from "node:assert/strict";
import { test } from "node:test";
import { orderEquipmentWeight } from "../src/features/sales/order-weight-model.ts";

test("peso total multiplica cada equipamento pela quantidade e conserva decimais", () => {
  assert.deepEqual(orderEquipmentWeight([{ quantity: "6.000000", weight: "180,5 kg" }, { quantity: "2", weight: "90.25 KG" }]), { totalKg: "1263.5", missingWeights: 0, invalidQuantities: false });
  assert.equal(orderEquipmentWeight([{ quantity: "0,125", weight: "0.001 kg" }]).totalKg, "0.000125");
  assert.equal(orderEquipmentWeight([{ quantity: "999999999999.999999", weight: "0.000001" }]).totalKg, "999999.999999999999");
});

test("peso incompleto nunca é publicado como zero ou como total parcial", () => {
  for (const weight of [null, undefined, "", "0 kg", "-1 kg", "10 lb", "aprox. 200 kg", "10-20 kg", "1e3", "NaN", "1.", "1,"]) {
    assert.deepEqual(orderEquipmentWeight([{ quantity: "2", weight: "100 kg" }, { quantity: "1", weight }]), { totalKg: null, missingWeights: 1, invalidQuantities: false });
  }
});

test("quantidade alterada ou removida recalcula o peso e quantidade inválida impede total", () => {
  assert.equal(orderEquipmentWeight([{ quantity: "1", weight: "180 kg" }]).totalKg, "180");
  assert.equal(orderEquipmentWeight([{ quantity: "2", weight: "180 kg" }]).totalKg, "360");
  assert.equal(orderEquipmentWeight([]).totalKg, "0");
  for (const quantity of ["", "0", "-1", "1e3", "1.0000001"]) {
    assert.deepEqual(orderEquipmentWeight([{ quantity, weight: "180 kg" }]), { totalKg: null, missingWeights: 0, invalidQuantities: true });
  }
});
