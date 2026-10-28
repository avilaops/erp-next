import assert from "node:assert/strict";
import { compareExperiments, exactMatch, numberRange, numericTolerance, pathFidelity, runExperiment } from "@avilaops/experiments";

const definition = {
  id: "consumer-addition",
  version: "1",
  hypothesis: "The packaged executor can evaluate addition.",
  dataset: {
    id: "addition", version: "1", split: "evaluation",
    cases: [{ id: "two-plus-three", input: { left: 2, right: 3 }, expected: 5 }],
  },
  variant: { id: "addition", version: "1", codeVersion: "consumer-smoke-v1" },
  evaluators: [exactMatch(), numericTolerance(), numberRange({ minimum: 0, maximum: 10 })],
};
const report = await runExperiment(definition, ({ left, right }) => ({ output: left + right }));
assert.equal(report.summary.verdict, "passed");
assert.equal(report.cases[0].output, 5);
assert.equal(report.cases[0].evaluations.length, 3);
assert.deepEqual(report.evaluators[2].parameters, { minimum: 0, maximum: 10, includeMinimum: true, includeMaximum: true });
assert.equal(numberRange({ minimum: 0, maximum: 10, includeMaximum: false }).evaluate({ output: 10 }).score, 0);
assert.equal(pathFidelity({ requiredNodes: ["fiscal"] }).evaluate({
  output: { trace: { complete: true, steps: [{ node: "fiscal", status: "succeeded" }] } },
}).score, 1);
assert.equal(compareExperiments(report, report).comparable, true);
const moduleUrl = import.meta.resolve("@avilaops/experiments");
assert.ok(moduleUrl.includes("verification/consumer/node_modules/@avilaops/experiments/"));
console.log(JSON.stringify({ status: "passed", importedFrom: moduleUrl, result: report.cases[0].output }));
